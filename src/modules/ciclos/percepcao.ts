import type { Agent, Simulacao } from "../../generated/prisma/client.ts";
import { prisma } from "../../db/prisma.ts";
import { TEXTO_COMPARTILHADO, alertasDeInjecao, textoCompartilhavel } from "./tipos.ts";
import type { AcaoImpactante, AgenteResumo, RelatorioComum, RelatorioEstado } from "./tipos.ts";

const TAMANHO_RANKING = 5;
const TOTAL_ACOES_IMPACTANTES = 3;
const TOTAL_TOPICOS = 3;
const SEGUNDOS_POR_DIA = 24 * 60 * 60;

type AgentePercebido = Pick<Agent, "id" | "nomeAgente" | "saldoMd" | "trustScore">;

/** Decisão válida do ciclo anterior, como lida dos logs. */
export interface DecisaoAnterior {
  agentId: number | null;
  acao: string;
  alvo: string | null;
  valor: number;
}

export interface Percepcao {
  comum: RelatorioComum;
  /** Um relatório completo por agente, na mesma ordem de `agentes`. */
  relatorios: RelatorioEstado[];
}

function resumir(agente: AgentePercebido): AgenteResumo {
  return {
    id: agente.id,
    nome: textoCompartilhavel(agente.nomeAgente),
    saldoMd: agente.saldoMd,
    trustScore: agente.trustScore,
  };
}

/**
 * Um alvo só entra no relatório dos outros agentes se passar pela mesma regra que a fase de
 * decisão aplica. Protege também contra logs gravados antes dessa validação existir.
 */
function alvoSeguro(alvo: unknown): string | null {
  if (typeof alvo !== "string") return null;
  const texto = alvo.trim();
  if (!TEXTO_COMPARTILHADO.test(texto) || alertasDeInjecao(texto).length > 0) return null;
  return texto;
}

interface DetalhesDecisao {
  resposta?: { action?: string; parameters?: { target?: unknown; value?: unknown } };
}

/**
 * Deriva os relatórios do ciclo a partir dos dados já lidos (função pura, sem banco).
 *
 * "Ações mais impactantes" usa `parameters.value` como proxy até a fase de resolução
 * calcular engajamento. "Tópicos em alta" são os alvos mais repetidos em CRIAR_CONCEITO
 * no ciclo anterior. `publicacoesRecentes` fica vazio até existir a tabela de posts.
 */
export function derivarPercepcao(
  simulacao: Pick<Simulacao, "id" | "intervaloSegundos">,
  agentes: AgentePercebido[],
  numeroCiclo: number,
  decisoesAnteriores: DecisaoAnterior[],
  geradoEm = new Date(),
): Percepcao {
  const nomePorId = new Map(agentes.map((a) => [a.id, textoCompartilhavel(a.nomeAgente)]));
  const decisoes = decisoesAnteriores.map((d) => ({ ...d, alvo: alvoSeguro(d.alvo) }));

  const acoesImpactantes: AcaoImpactante[] = [...decisoes]
    .sort((a, b) => b.valor - a.valor)
    .slice(0, TOTAL_ACOES_IMPACTANTES)
    .map((d) => ({
      agentId: d.agentId ?? 0,
      agente: (d.agentId !== null ? nomePorId.get(d.agentId) : undefined) ?? `agente ${d.agentId ?? 0}`,
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

  const comum: RelatorioComum = {
    simulacaoId: simulacao.id,
    ciclo: numeroCiclo,
    dia,
    geradoEm: geradoEm.toISOString(),
    ecossistema: { totalAgentes: agentes.length, ranking },
    topicosEmAlta,
    acoesImpactantesCicloAnterior: acoesImpactantes,
    publicacoesRecentes: [],
  };

  return {
    comum,
    relatorios: agentes.map((agente) => ({ ...comum, agente: resumir(agente) })),
  };
}

/**
 * Fase de percepção. Faz uma única leitura do banco para o ciclo inteiro (as decisões do
 * ciclo anterior) e deriva dela o relatório de cada agente, em vez de consultar o banco
 * uma vez por agente.
 */
export async function montarPercepcao(
  simulacao: Simulacao,
  agentes: Agent[],
  numeroCiclo: number,
): Promise<Percepcao> {
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

  const decisoes: DecisaoAnterior[] = logsAnteriores.map((log) => {
    const parametros = (log.detalhes as DetalhesDecisao | null)?.resposta?.parameters;
    return {
      agentId: log.agentId,
      acao: log.acao ?? "OCIOSO",
      alvo: typeof parametros?.target === "string" ? parametros.target : null,
      valor: typeof parametros?.value === "number" ? parametros.value : 0,
    };
  });

  return derivarPercepcao(simulacao, agentes, numeroCiclo, decisoes);
}
