import { Prisma } from "../../generated/prisma/client.ts";
import { env } from "../../config/env.ts";
import { prisma } from "../../db/prisma.ts";
import { tentarTravarSimulacao } from "../../db/travas.ts";
import { publicarEvento } from "../../queue/rabbitmq.ts";
import { AppError, Errors } from "../../utils/errors.ts";
import { logger } from "../../utils/logger.ts";
import { decidirTodos, limpar } from "./decisao.ts";
import { criarGateway } from "./gateway.ts";
import { montarPercepcao } from "./percepcao.ts";
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

/** Linhas por `createMany`; mantém cada comando bem abaixo do limite de parâmetros do Postgres. */
const LOTE_INSERCAO = 500;
/** Prazo da transação que grava as decisões e fecha o ciclo (o padrão do Prisma é 5 s). */
const TIMEOUT_TRANSACAO_MS = 30_000;
/** Atraso entre o início de simulações retomadas, para não abrir todos os ciclos no mesmo instante. */
const ESCALONAMENTO_MS = 200;

const ERRO_ORFAO = "Interrompido: nenhum processo executava o ciclo (queda ou reinício do serviço)";

/**
 * O último ciclo da simulação começou há menos de um intervalo. Acontece com mais de um worker:
 * cada um tem seu relógio, e sem esta checagem a frequência real seria multiplicada por eles.
 */
class CicloAdiado extends Error {
  restanteMs: number;
  constructor(restanteMs: number) {
    super(`Próximo ciclo em ${restanteMs} ms`);
    this.restanteMs = restanteMs;
  }
}

function json(valor: unknown): Prisma.InputJsonValue {
  return limpar(valor) as Prisma.InputJsonValue;
}

function emLotes<T>(itens: T[], tamanho = LOTE_INSERCAO): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/**
 * Orquestrador do ciclo de simulação.
 *
 * Roda no processo do worker (`npm run worker`); a API só usa `executarCiclo` para a execução
 * manual de um ciclo e muda a `situacao` da simulação para ligar ou desligar o laço.
 *
 * - Antes de cada ciclo o processo toma a trava da simulação no Postgres
 *   (`pg_try_advisory_lock`). Com vários workers (ou API + worker), só um executa cada ciclo;
 *   quem não consegue a trava desiste daquela volta.
 * - Cada simulação em execução tem um laço próprio: o próximo ciclo só é agendado depois que
 *   o anterior termina (setTimeout encadeado, não setInterval).
 * - A `situacao` e o intervalo são lidos do banco a cada volta; alterá-los vale a partir do
 *   ciclo seguinte. `sincronizar()` descobre simulações ligadas ou desligadas pela API.
 * - Um ciclo EM_ANDAMENTO cuja trava está livre é órfão (o processo que o rodava caiu): vira
 *   FALHOU. Um ciclo vivo em outro processo segura a trava e nunca é marcado.
 */
export class Orquestrador {
  private gateway: LlmGateway;
  private config: ConfigDecisao;
  private ativos = new Set<number>();
  private timers = new Map<number, NodeJS.Timeout>();
  private emVoo = new Set<Promise<unknown>>();
  private emExecucao = new Set<number>();
  private timerSincronizacao: NodeJS.Timeout | null = null;
  private encerrado = false;
  private log = logger.child({ componente: "orquestrador" });

  constructor(gateway: LlmGateway, config?: Partial<ConfigDecisao>) {
    this.gateway = gateway;
    this.config = {
      concorrencia: env.decisaoConcorrencia,
      timeoutMs: env.decisaoTimeoutMs,
      tentativas: env.decisaoTentativas,
      ...config,
    };
  }

  /** Indica se ESTE processo mantém o laço da simulação. */
  estaAtivo(simulacaoId: number): boolean {
    return this.ativos.has(simulacaoId);
  }

  /** Executa exatamente um ciclo agora e devolve o resumo (execução manual, sem esperar o intervalo). */
  async executarCiclo(simulacaoId: number): Promise<ResumoCiclo> {
    return this.executar(simulacaoId);
  }

  /** Com `intervaloMs`, adia (CicloAdiado) se o último ciclo começou há menos que isso. */
  private async executar(simulacaoId: number, intervaloMs?: number): Promise<ResumoCiclo> {
    if (this.emExecucao.has(simulacaoId)) {
      throw Errors.conflict("ciclo_em_andamento", "Já existe um ciclo em andamento nesta simulação");
    }
    this.emExecucao.add(simulacaoId);
    const execucao = this.comTrava(simulacaoId, intervaloMs);
    this.emVoo.add(execucao);
    try {
      return await execucao;
    } finally {
      this.emVoo.delete(execucao);
      this.emExecucao.delete(simulacaoId);
    }
  }

  /** Chamar na inicialização do worker: fecha ciclos órfãos e liga as simulações EXECUTANDO. */
  async retomar(): Promise<void> {
    await this.marcarOrfaos();
    await this.sincronizar();
  }

  /**
   * Alinha os laços deste processo com o banco: liga simulações EXECUTANDO que ainda não têm
   * laço aqui e desliga as que a API pausou. Barato o bastante para rodar a cada poucos segundos.
   */
  async sincronizar(): Promise<void> {
    if (this.encerrado) return;
    const simulacoes = await prisma.simulacao.findMany({
      where: { situacao: "EXECUTANDO" },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    const executando = new Set(simulacoes.map((s) => s.id));

    for (const id of [...this.ativos]) {
      if (!executando.has(id)) {
        this.ativos.delete(id);
        this.cancelarTimer(id);
      }
    }

    let novos = 0;
    for (const id of executando) {
      if (this.ativos.has(id)) continue;
      this.ativos.add(id);
      this.agendar(id, novos++ * ESCALONAMENTO_MS);
    }
    if (novos > 0) this.log.info({ novos }, "simulações em execução assumidas por este processo");
  }

  /** Repete `sincronizar()` a cada `intervaloMs` até `encerrar()`. */
  iniciarSincronizacao(intervaloMs: number): void {
    const proxima = () => {
      this.timerSincronizacao = setTimeout(() => {
        this.sincronizar()
          .catch((err) => this.log.error({ err }, "falha ao sincronizar simulações"))
          .finally(() => {
            if (!this.encerrado) proxima();
          });
      }, intervaloMs);
    };
    proxima();
  }

  /** Chamar no desligamento: cancela agendamentos e espera ciclos em voo terminarem. */
  async encerrar(): Promise<void> {
    this.encerrado = true;
    if (this.timerSincronizacao) clearTimeout(this.timerSincronizacao);
    this.timerSincronizacao = null;
    this.ativos.clear();
    for (const id of [...this.timers.keys()]) this.cancelarTimer(id);
    await Promise.allSettled([...this.emVoo]);
  }

  private async comTrava(simulacaoId: number, intervaloMs?: number): Promise<ResumoCiclo> {
    const trava = await tentarTravarSimulacao(simulacaoId);
    if (!trava) {
      throw Errors.conflict("ciclo_em_andamento", "Outro processo está executando um ciclo desta simulação");
    }
    try {
      if (intervaloMs !== undefined) {
        const ultimo = await prisma.ciclo.findFirst({
          where: { simulacaoId },
          orderBy: { numero: "desc" },
          select: { inicio: true },
        });
        const decorrido = ultimo ? Date.now() - ultimo.inicio.getTime() : Infinity;
        // decorrido < 0 só com relógios divergentes; nesse caso não adia para não travar o laço.
        if (decorrido >= 0 && decorrido < intervaloMs) throw new CicloAdiado(intervaloMs - decorrido);
      }
      return await this.rodarCiclo(simulacaoId);
    } finally {
      await trava.liberar();
    }
  }

  private async marcarOrfaos(): Promise<void> {
    const pendentes = await prisma.ciclo.findMany({
      where: { situacao: "EM_ANDAMENTO" },
      distinct: ["simulacaoId"],
      select: { simulacaoId: true },
    });
    let total = 0;
    for (const { simulacaoId } of pendentes) {
      const trava = await tentarTravarSimulacao(simulacaoId);
      if (!trava) continue; // ciclo vivo em outro processo
      try {
        total += await this.fecharOrfaos(simulacaoId);
      } finally {
        await trava.liberar();
      }
    }
    if (total > 0) this.log.warn({ total }, "ciclos interrompidos marcados como FALHOU");
  }

  /** Só chamar segurando a trava da simulação. */
  private async fecharOrfaos(simulacaoId: number): Promise<number> {
    const { count } = await prisma.ciclo.updateMany({
      where: { simulacaoId, situacao: "EM_ANDAMENTO" },
      data: { situacao: "FALHOU", fim: new Date(), erro: ERRO_ORFAO },
    });
    return count;
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

  /** Lê a simulação; devolve o intervalo (s) se ela continua EXECUTANDO, ou `null` para parar o laço. */
  private async intervaloSeExecutando(simulacaoId: number): Promise<number | null> {
    const simulacao = await prisma.simulacao.findUnique({
      where: { id: simulacaoId },
      select: { situacao: true, intervaloSegundos: true },
    });
    if (simulacao?.situacao !== "EXECUTANDO") return null;
    return Math.max(simulacao.intervaloSegundos, env.intervaloMinimoSegundos);
  }

  private async volta(simulacaoId: number): Promise<void> {
    this.timers.delete(simulacaoId);
    if (!this.ativos.has(simulacaoId)) return;
    const log = this.log.child({ simulacaoId });

    let intervaloSegundos: number | null;
    try {
      intervaloSegundos = await this.intervaloSeExecutando(simulacaoId);
      if (intervaloSegundos === null) {
        this.ativos.delete(simulacaoId);
        return;
      }
    } catch (err) {
      log.error({ err }, "falha ao ler a simulação; nova tentativa no intervalo padrão");
      this.agendar(simulacaoId, env.cicloIntervaloPadraoSegundos * 1000);
      return;
    }

    const inicio = Date.now();
    try {
      await this.executar(simulacaoId, intervaloSegundos * 1000);
    } catch (err) {
      if (err instanceof CicloAdiado) {
        // Outro processo rodou o ciclo desta janela: espera o fim dela, sem reler o banco agora.
        if (this.ativos.has(simulacaoId)) this.agendar(simulacaoId, err.restanteMs + ESCALONAMENTO_MS);
        return;
      }
      if (err instanceof AppError && err.code === "sem_agentes") {
        log.warn("simulação sem agentes ativos: ciclo pulado");
      } else if (err instanceof AppError && err.code === "ciclo_em_andamento") {
        log.debug("ciclo desta volta já está com outro processo");
      } else {
        log.error({ err }, "ciclo falhou");
      }
    }

    if (!this.ativos.has(simulacaoId)) return;
    try {
      const intervalo = await this.intervaloSeExecutando(simulacaoId);
      if (intervalo === null) {
        this.ativos.delete(simulacaoId);
        return;
      }
      this.agendar(simulacaoId, Math.max(0, intervalo * 1000 - (Date.now() - inicio)));
    } catch (err) {
      // Falha transitória do banco: tenta de novo no intervalo padrão em vez de matar o laço.
      log.error({ err }, "reagendamento falhou; nova tentativa no intervalo padrão");
      this.agendar(simulacaoId, env.cicloIntervaloPadraoSegundos * 1000);
    }
  }

  /** Só chamar segurando a trava da simulação. */
  private async abrirCiclo(simulacaoId: number, totalAgentes: number) {
    const ultimo = await prisma.ciclo.findFirst({
      where: { simulacaoId },
      orderBy: { numero: "desc" },
    });
    if (ultimo?.situacao === "EM_ANDAMENTO") {
      // Com a trava na mão, ninguém mais está rodando este ciclo: é órfão de uma queda.
      await this.fecharOrfaos(simulacaoId);
      this.log.warn({ simulacaoId, ciclo: ultimo.numero }, "ciclo órfão marcado como FALHOU");
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
    if (agentes.length === 0) {
      throw Errors.conflict("sem_agentes", "A simulação não tem agentes ativos para participar do ciclo");
    }
    const ciclo = await this.abrirCiclo(simulacaoId, agentes.length);
    const log = this.log.child({ simulacaoId, ciclo: ciclo.numero });

    try {
      // Fase 1: percepção. A parte comum vai uma vez no ciclo; por agente, só o bloco `agente`.
      const { comum, relatorios } = await montarPercepcao(simulacao, agentes, ciclo.numero);
      await prisma.ciclo.update({ where: { id: ciclo.id }, data: { relatorioComum: json(comum) } });
      for (const lote of emLotes(relatorios)) {
        await prisma.logCiclo.createMany({
          data: lote.map((relatorio) => ({
            cicloId: ciclo.id,
            agentId: relatorio.agente.id,
            fase: "PERCEPCAO" as const,
            acao: null,
            detalhes: json({ agente: relatorio.agente }),
          })),
        });
      }

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
          relatorio: relatorios[i] as (typeof relatorios)[number],
        })),
        this.config,
      );
      const validas = decisoes.filter((d) => d.valido).length;

      for (const d of decisoes) {
        if (d.alertas.length > 0) {
          log.warn({ agentId: d.agentId, alertas: d.alertas, valido: d.valido }, "possível injeção de prompt na resposta do agente");
        }
      }

      // Logs de decisão e fechamento do ciclo na mesma transação: ou fica tudo, ou nada.
      const fechado = await prisma.$transaction(
        async (tx) => {
          for (const lote of emLotes(decisoes)) {
            await tx.logCiclo.createMany({
              data: lote.map((d) => ({
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
                  ...(d.alertas.length > 0 ? { alertas: d.alertas } : {}),
                }),
                latenciaMs: d.latenciaMs,
                tokensEntrada: d.tokensEntrada,
                tokensSaida: d.tokensSaida,
              })),
            });
          }
          return tx.ciclo.update({
            where: { id: ciclo.id },
            data: { situacao: "CONCLUIDO", fim: new Date(), decisoesValidas: validas },
          });
        },
        { timeout: TIMEOUT_TRANSACAO_MS },
      );
      const resumo = resumir(fechado);
      log.info({ duracaoMs: resumo.duracaoMs, totalAgentes: resumo.totalAgentes, decisoesValidas: validas }, "ciclo concluído");
      publicarEvento("ciclo.concluido", { ...resumo });
      return resumo;
    } catch (erro) {
      const mensagem = limpar(erro instanceof Error ? erro.message : String(erro)) as string;
      log.error({ err: erro }, "ciclo falhou");
      await prisma.ciclo
        .update({
          where: { id: ciclo.id },
          data: { situacao: "FALHOU", fim: new Date(), erro: mensagem.slice(0, 1000) },
        })
        .catch(() => undefined);
      publicarEvento("ciclo.falhou", { simulacaoId, numero: ciclo.numero, erro: mensagem.slice(0, 1000) });
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
