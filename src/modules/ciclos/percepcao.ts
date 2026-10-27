import type { Agent, Simulacao } from "../../generated/prisma/client.ts";
import { prisma } from "../../db/prisma.ts";
import type { AcaoImpactante, AgenteResumo, RelatorioEstado } from "./tipos.ts";

const TAMANHO_RANKING = 5;
const TOTAL_ACOES_IMPACTANTES = 3;
const TOTAL_TOPICOS = 3;
const SEGUNDOS_POR_DIA = 24 * 60 * 60;

function resumir(agente: Agent): AgenteResumo {
  return {
    id: agente.id,
    nome: agente.nomeAgente,
    saldoMd: agente.saldoMd,
    trustScore: agente.trustScore,
  };
}

interface DetalhesDecisao {
  resposta?: { action?: string; parameters?: { target?: string; value?: number } };
}

/**
 * Fase de percepção. Faz uma única leitura do banco para o ciclo inteiro (agentes e
 * decisões do ciclo anterior) e deriva dela o relatório de cada agente, em vez de
 * consultar o banco uma vez por agente.
 *
 * "Ações mais impactantes" usa `parameters.value` como proxy até a fase de resolução
 * calcular engajamento. "Tópicos em alta" são os alvos mais repetidos em CRIAR_CONCEITO
 * no ciclo anterior. `publicacoesRecentes` fica vazio até existir a tabela de posts.
 */
export async function montarRelatorios(
  simulacao: Simulacao,
  agentes: Agent[],
  numeroCiclo: number,
): Promise<RelatorioEstado[]> {
  const nomePorId = new Map(agentes.map((a) => [a.id, a.nomeAgente]));

  const logsAnteriores =
    numeroCiclo > 1
      ? await prisma.logCiclo.findMany({
          where: {
            fase: "DECISAO",
            valido: true,
            acao: { not: "OCIOSO" },
            ciclo: {
              simulacaoId: simulacao.id,
              numero: numeroCiclo - 1,
              situacao: "CONCLUIDO",
            },
          },
          orderBy: { id: "asc" },
        })
      : [];

  const decisoes = logsAnteriores.map((log) => {
    const detalhes = log.detalhes as DetalhesDecisao | null;
    return {
      agentId: log.agentId,
      acao: log.acao ?? "OCIOSO",
      alvo: detalhes?.resposta?.parameters?.target ?? null,
      valor: detalhes?.resposta?.parameters?.value ?? 0,
    };
  });

  const acoesImpactantes: AcaoImpactante[] = [...decisoes]
    .sort((a, b) => b.valor - a.valor)
    .slice(0, TOTAL_ACOES_IMPACTANTES)
    .map((d) => ({
      agentId: d.agentId ?? 0,
      agente: (d.agentId !== null ? nomePorId.get(d.agentId) : undefined) ?? `agente #${d.agentId}`,
      acao: d.acao,
      alvo: d.alvo,
    }));

  const contagemTopicos = new Map<string, number>();
  for (const d of decisoes) {
    if (d.acao === "CRIAR_CONCEITO" && d.alvo) {
      contagemTopicos.set(d.alvo, (contagemTopicos.get(d.alvo) ?? 0) + 1);
    }
  }
  const topicosEmAlta = [...contagemTopicos.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOTAL_TOPICOS)
    .map(([topico]) => topico);

  const ranking = [...agentes]
    .sort((a, b) => b.saldoMd - a.saldoMd || b.trustScore - a.trustScore || a.id - b.id)
    .slice(0, TAMANHO_RANKING)
    .map(resumir);

  const dia = Math.floor(((numeroCiclo - 1) * simulacao.intervaloSegundos) / SEGUNDOS_POR_DIA) + 1;
  const geradoEm = new Date().toISOString();

  return agentes.map((agente) => ({
    simulacaoId: simulacao.id,
    ciclo: numeroCiclo,
    dia,
    geradoEm,
    agente: resumir(agente),
    ecossistema: { totalAgentes: agentes.length, ranking },
    topicosEmAlta,
    acoesImpactantesCicloAnterior: acoesImpactantes,
    publicacoesRecentes: [],
  }));
}
