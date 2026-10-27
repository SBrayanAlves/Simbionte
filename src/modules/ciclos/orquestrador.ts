import { Prisma } from "../../generated/prisma/client.ts";
import { env } from "../../config/env.ts";
import { prisma } from "../../db/prisma.ts";
import { Errors } from "../../utils/errors.ts";
import { decidirTodos } from "./decisao.ts";
import { criarGateway } from "./gateway.ts";
import { montarRelatorios } from "./percepcao.ts";
import type { ConfigDecisao } from "./decisao.ts";
import type { LlmGateway } from "./tipos.ts";

export interface ResumoCiclo {
  id: number;
  simulacaoId: number;
  numero: number;
  situacao: "EM_ANDAMENTO" | "CONCLUIDO" | "FALHOU";
  inicio: Date;
  fim: Date | null;
  duracaoMs: number | null;
  totalAgentes: number;
  decisoesValidas: number;
  erro: string | null;
}

function json(valor: unknown): Prisma.InputJsonValue {
  return valor as Prisma.InputJsonValue;
}

/**
 * Orquestrador do ciclo de simulação, executado como serviço dentro do processo do backend.
 *
 * - Cada simulação em execução tem um laço próprio: o próximo ciclo só é agendado depois que
 *   o anterior termina (setTimeout encadeado, não setInterval), então dois ciclos da mesma
 *   simulação nunca se sobrepõem, mesmo quando o LLM demora mais que o intervalo.
 * - O intervalo é lido do banco a cada volta; alterá-lo vale a partir do ciclo seguinte.
 * - Ao subir, `retomar()` marca como FALHOU os ciclos que ficaram EM_ANDAMENTO por uma queda
 *   e reinicia as simulações que estavam EXECUTANDO.
 */
export class Orquestrador {
  private gateway: LlmGateway;
  private config: ConfigDecisao;
  private ativos = new Set<number>();
  private timers = new Map<number, NodeJS.Timeout>();
  private emVoo = new Set<Promise<unknown>>();
  private emExecucao = new Set<number>();

  constructor(gateway: LlmGateway, config?: Partial<ConfigDecisao>) {
    this.gateway = gateway;
    this.config = {
      concorrencia: env.decisaoConcorrencia,
      timeoutMs: env.decisaoTimeoutMs,
      tentativas: env.decisaoTentativas,
      ...config,
    };
  }

  estaAtivo(simulacaoId: number): boolean {
    return this.ativos.has(simulacaoId);
  }

  /** Liga o laço contínuo da simulação; o primeiro ciclo começa imediatamente. */
  async iniciar(simulacaoId: number): Promise<void> {
    if (this.ativos.has(simulacaoId)) {
      throw Errors.conflict("simulacao_em_execucao", "A simulação já está em execução");
    }
    await prisma.simulacao.update({
      where: { id: simulacaoId },
      data: { situacao: "EXECUTANDO" },
    });
    this.ativos.add(simulacaoId);
    this.agendar(simulacaoId, 0);
  }

  /** Para o laço. Um ciclo em andamento termina normalmente; nenhum novo é iniciado. */
  async parar(simulacaoId: number): Promise<void> {
    this.ativos.delete(simulacaoId);
    this.cancelarTimer(simulacaoId);
    await prisma.simulacao.update({
      where: { id: simulacaoId },
      data: { situacao: "PAUSADA" },
    });
  }

  /** Executa exatamente um ciclo agora e devolve o resumo. */
  async executarCiclo(simulacaoId: number): Promise<ResumoCiclo> {
    if (this.emExecucao.has(simulacaoId)) {
      throw Errors.conflict("ciclo_em_andamento", "Já existe um ciclo em andamento nesta simulação");
    }
    this.emExecucao.add(simulacaoId);
    const execucao = this.rodarCiclo(simulacaoId);
    this.emVoo.add(execucao);
    try {
      return await execucao;
    } finally {
      this.emVoo.delete(execucao);
      this.emExecucao.delete(simulacaoId);
    }
  }

  /** Chamar na inicialização do servidor. */
  async retomar(): Promise<void> {
    const orfaos = await prisma.ciclo.updateMany({
      where: { situacao: "EM_ANDAMENTO" },
      data: { situacao: "FALHOU", fim: new Date(), erro: "Interrompido por reinício do serviço" },
    });
    if (orfaos.count > 0) {
      console.warn(`${orfaos.count} ciclo(s) interrompido(s) foram marcados como FALHOU.`);
    }

    const simulacoes = await prisma.simulacao.findMany({
      where: { situacao: "EXECUTANDO" },
      orderBy: { id: "asc" },
    });
    simulacoes.forEach((simulacao, indice) => {
      this.ativos.add(simulacao.id);
      this.agendar(simulacao.id, indice * 200);
    });
  }

  /** Chamar no desligamento: cancela agendamentos e espera ciclos em voo terminarem. */
  async encerrar(): Promise<void> {
    this.ativos.clear();
    for (const id of [...this.timers.keys()]) this.cancelarTimer(id);
    await Promise.allSettled([...this.emVoo]);
  }

  private agendar(simulacaoId: number, atrasoMs: number): void {
    this.cancelarTimer(simulacaoId);
    const timer = setTimeout(() => void this.volta(simulacaoId), atrasoMs);
    timer.unref();
    this.timers.set(simulacaoId, timer);
  }

  private cancelarTimer(simulacaoId: number): void {
    const timer = this.timers.get(simulacaoId);
    if (timer) clearTimeout(timer);
    this.timers.delete(simulacaoId);
  }

  private async volta(simulacaoId: number): Promise<void> {
    this.timers.delete(simulacaoId);
    if (!this.ativos.has(simulacaoId)) return;

    const inicio = Date.now();
    try {
      await this.executarCiclo(simulacaoId);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      console.error(`Ciclo da simulação ${simulacaoId} falhou: ${mensagem}`);
    }

    if (!this.ativos.has(simulacaoId)) return;
    try {
      const simulacao = await prisma.simulacao.findUnique({ where: { id: simulacaoId } });
      if (!simulacao || simulacao.situacao !== "EXECUTANDO") {
        this.ativos.delete(simulacaoId);
        return;
      }
      const restante = simulacao.intervaloSegundos * 1000 - (Date.now() - inicio);
      this.agendar(simulacaoId, Math.max(0, restante));
    } catch (erro) {
      // Falha transitória do banco: tenta de novo no intervalo padrão em vez de matar o laço.
      console.error(`Reagendamento da simulação ${simulacaoId} falhou:`, erro);
      this.agendar(simulacaoId, env.cicloIntervaloPadraoSegundos * 1000);
    }
  }

  private async abrirCiclo(simulacaoId: number, totalAgentes: number) {
    const ultimo = await prisma.ciclo.findFirst({
      where: { simulacaoId },
      orderBy: { numero: "desc" },
    });
    if (ultimo?.situacao === "EM_ANDAMENTO") {
      throw Errors.conflict("ciclo_em_andamento", "Já existe um ciclo em andamento nesta simulação");
    }
    try {
      return await prisma.ciclo.create({
        data: { simulacaoId, numero: (ultimo?.numero ?? 0) + 1, totalAgentes },
      });
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
        throw Errors.conflict("ciclo_em_andamento", "Outro ciclo foi aberto ao mesmo tempo");
      }
      throw erro;
    }
  }

  private async rodarCiclo(simulacaoId: number): Promise<ResumoCiclo> {
    const simulacao = await prisma.simulacao.findUnique({ where: { id: simulacaoId } });
    if (!simulacao) throw Errors.notFound("Simulação não encontrada");

    const agentes = await prisma.agent.findMany({
      where: { simulacaoId, ativo: true },
      orderBy: { id: "asc" },
    });
    const ciclo = await this.abrirCiclo(simulacaoId, agentes.length);

    try {
      // Fase 1: percepção
      const relatorios = await montarRelatorios(simulacao, agentes, ciclo.numero);
      await prisma.logCiclo.createMany({
        data: relatorios.map((relatorio) => ({
          cicloId: ciclo.id,
          agentId: relatorio.agente.id,
          fase: "PERCEPCAO" as const,
          acao: null,
          detalhes: json(relatorio),
        })),
      });

      // Fase 2: decisão
      const decisoes = await decidirTodos(
        this.gateway,
        agentes.map((agente, i) => ({
          agente: {
            id: agente.id,
            nome: agente.nomeAgente,
            provedorLlm: agente.provedorLlm,
            promptAlma: agente.promptAlma,
            chaveApiCriptografada: agente.chaveApiCriptografada,
          },
          relatorio: relatorios[i]!,
        })),
        this.config,
      );
      const validas = decisoes.filter((d) => d.valido).length;

      // Logs de decisão e fechamento do ciclo na mesma transação: ou fica tudo, ou nada.
      const fechado = await prisma.$transaction(async (tx) => {
        await tx.logCiclo.createMany({
          data: decisoes.map((d) => ({
            cicloId: ciclo.id,
            agentId: d.agentId,
            fase: "DECISAO" as const,
            acao: d.resposta.action,
            valido: d.valido,
            detalhes: json({
              resposta: d.resposta,
              bruto: d.bruto,
              erro: d.erro,
              tentativas: d.tentativas,
            }),
            latenciaMs: d.latenciaMs,
            tokensEntrada: d.tokensEntrada,
            tokensSaida: d.tokensSaida,
          })),
        });
        return tx.ciclo.update({
          where: { id: ciclo.id },
          data: { situacao: "CONCLUIDO", fim: new Date(), decisoesValidas: validas },
        });
      });
      return resumir(fechado);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await prisma.ciclo
        .update({
          where: { id: ciclo.id },
          data: { situacao: "FALHOU", fim: new Date(), erro: mensagem.slice(0, 1000) },
        })
        .catch(() => undefined);
      throw erro;
    }
  }
}

export function resumir(ciclo: {
  id: number;
  simulacaoId: number;
  numero: number;
  situacao: "EM_ANDAMENTO" | "CONCLUIDO" | "FALHOU";
  inicio: Date;
  fim: Date | null;
  totalAgentes: number;
  decisoesValidas: number;
  erro: string | null;
}): ResumoCiclo {
  return {
    id: ciclo.id,
    simulacaoId: ciclo.simulacaoId,
    numero: ciclo.numero,
    situacao: ciclo.situacao,
    inicio: ciclo.inicio,
    fim: ciclo.fim,
    duracaoMs: ciclo.fim ? ciclo.fim.getTime() - ciclo.inicio.getTime() : null,
    totalAgentes: ciclo.totalAgentes,
    decisoesValidas: ciclo.decisoesValidas,
    erro: ciclo.erro,
  };
}

export const orquestrador = new Orquestrador(criarGateway());
