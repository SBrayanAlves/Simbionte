import { env } from "../../config/env.ts";
import { prisma } from "../../db/prisma.ts";
import { publicarEvento } from "../../queue/rabbitmq.ts";
import { Errors } from "../../utils/errors.ts";
import { orquestrador, resumir } from "../ciclos/orquestrador.ts";
import type {
  CriarAgenteInput,
  CriarSimulacaoInput,
  ListarCiclosQuery,
  ObterCicloQuery,
} from "./simulacoes.validators.ts";

/** Garante que a simulação existe e pertence ao usuário; caso contrário responde 404. */
async function obterPropria(usuarioId: number, simulacaoId: number) {
  const simulacao = await prisma.simulacao.findFirst({
    where: { id: simulacaoId, usuarioId },
  });
  if (!simulacao) throw Errors.notFound("Simulação não encontrada");
  return simulacao;
}

function exigirIntervaloMinimo(intervaloSegundos: number) {
  if (intervaloSegundos < env.intervaloMinimoSegundos) {
    throw Errors.unprocessable(
      "intervalo_abaixo_do_minimo",
      `O intervalo mínimo entre ciclos é de ${env.intervaloMinimoSegundos} segundo(s)`,
    );
  }
}

async function exigirAgentesAtivos(simulacaoId: number) {
  const agentes = await prisma.agent.count({ where: { simulacaoId, ativo: true } });
  if (agentes === 0) {
    throw Errors.conflict("sem_agentes", "A simulação não tem agentes ativos para participar do ciclo");
  }
}

function publica(simulacao: {
  id: number;
  nome: string;
  intervaloSegundos: number;
  situacao: string;
  createdAt: Date;
}) {
  return {
    id: simulacao.id,
    nome: simulacao.nome,
    intervaloSegundos: simulacao.intervaloSegundos,
    situacao: simulacao.situacao,
    // O laço roda no worker; "em execução" é o que está gravado no banco.
    emExecucao: simulacao.situacao === "EXECUTANDO",
    createdAt: simulacao.createdAt,
  };
}

export async function criarSimulacao(usuarioId: number, input: CriarSimulacaoInput) {
  exigirIntervaloMinimo(input.intervaloSegundos);
  const existentes = await prisma.simulacao.count({ where: { usuarioId } });
  if (existentes >= env.maxSimulacoesPorUsuario) {
    throw Errors.unprocessable(
      "limite_simulacoes",
      `Limite de ${env.maxSimulacoesPorUsuario} simulações por usuário atingido`,
    );
  }
  const simulacao = await prisma.simulacao.create({
    data: { usuarioId, nome: input.nome, intervaloSegundos: input.intervaloSegundos },
  });
  return publica(simulacao);
}

export async function listarSimulacoes(usuarioId: number) {
  const simulacoes = await prisma.simulacao.findMany({
    where: { usuarioId },
    orderBy: { id: "desc" },
  });
  return simulacoes.map(publica);
}

export async function obterSimulacao(usuarioId: number, simulacaoId: number) {
  const simulacao = await obterPropria(usuarioId, simulacaoId);
  const [totalAgentes, ultimoCiclo] = await Promise.all([
    prisma.agent.count({ where: { simulacaoId, ativo: true } }),
    prisma.ciclo.findFirst({ where: { simulacaoId }, orderBy: { numero: "desc" } }),
  ]);
  return {
    ...publica(simulacao),
    totalAgentes,
    ultimoCiclo: ultimoCiclo ? resumir(ultimoCiclo) : null,
  };
}

function agentePublico(agente: {
  id: number;
  simulacaoId: number;
  nomeAgente: string;
  provedorLlm: string;
  saldoMd: number;
  trustScore: number;
  ativo: boolean;
}) {
  return {
    id: agente.id,
    simulacaoId: agente.simulacaoId,
    nomeAgente: agente.nomeAgente,
    provedorLlm: agente.provedorLlm,
    saldoMd: agente.saldoMd,
    trustScore: agente.trustScore,
    ativo: agente.ativo,
  };
}

export async function criarAgente(usuarioId: number, simulacaoId: number, input: CriarAgenteInput) {
  await obterPropria(usuarioId, simulacaoId);
  const existentes = await prisma.agent.count({ where: { simulacaoId } });
  if (existentes >= env.maxAgentesPorSimulacao) {
    throw Errors.unprocessable(
      "limite_agentes",
      `Limite de ${env.maxAgentesPorSimulacao} agentes por simulação atingido`,
    );
  }
  const agente = await prisma.agent.create({
    data: {
      usuarioId,
      simulacaoId,
      nomeAgente: input.nomeAgente,
      provedorLlm: input.provedorLlm,
      promptAlma: input.promptAlma,
    },
  });
  return agentePublico(agente);
}

export async function listarAgentes(usuarioId: number, simulacaoId: number) {
  await obterPropria(usuarioId, simulacaoId);
  const agentes = await prisma.agent.findMany({
    where: { simulacaoId },
    orderBy: { id: "asc" },
  });
  return agentes.map(agentePublico);
}

/**
 * Liga o laço contínuo: só grava EXECUTANDO; o worker percebe na próxima sincronização.
 * A troca é condicional no banco, então duas chamadas simultâneas não passam juntas.
 */
export async function iniciarCiclos(usuarioId: number, simulacaoId: number) {
  const simulacao = await obterPropria(usuarioId, simulacaoId);
  exigirIntervaloMinimo(simulacao.intervaloSegundos);
  await exigirAgentesAtivos(simulacaoId);

  const { count } = await prisma.simulacao.updateMany({
    where: { id: simulacaoId, usuarioId, situacao: { not: "EXECUTANDO" } },
    data: { situacao: "EXECUTANDO" },
  });
  if (count === 0) {
    throw Errors.conflict("simulacao_em_execucao", "A simulação já está em execução");
  }
  publicarEvento("simulacao.situacao", { simulacaoId, situacao: "EXECUTANDO" });
  return publica({ ...simulacao, situacao: "EXECUTANDO" });
}

/** Para o laço. Um ciclo em andamento termina normalmente; nenhum novo é iniciado. */
export async function pararCiclos(usuarioId: number, simulacaoId: number) {
  const simulacao = await obterPropria(usuarioId, simulacaoId);
  await prisma.simulacao.update({ where: { id: simulacaoId }, data: { situacao: "PAUSADA" } });
  publicarEvento("simulacao.situacao", { simulacaoId, situacao: "PAUSADA" });
  return publica({ ...simulacao, situacao: "PAUSADA" });
}

export async function executarCiclo(usuarioId: number, simulacaoId: number) {
  await obterPropria(usuarioId, simulacaoId);
  return orquestrador.executarCiclo(simulacaoId);
}

export async function listarCiclos(
  usuarioId: number,
  simulacaoId: number,
  { limit, offset }: ListarCiclosQuery,
) {
  await obterPropria(usuarioId, simulacaoId);
  const [total, ciclos] = await Promise.all([
    prisma.ciclo.count({ where: { simulacaoId } }),
    prisma.ciclo.findMany({
      where: { simulacaoId },
      orderBy: { numero: "desc" },
      take: limit,
      skip: offset,
    }),
  ]);
  return { total, ciclos: ciclos.map(resumir) };
}

/**
 * Ciclo com logs paginados (`limit` padrão 100, teto 500) e filtráveis por `fase` e `agentId`.
 * Os `detalhes` dos logs de percepção só vêm com `detalhes=true`; a parte do relatório comum
 * a todos os agentes vem uma vez, em `relatorioComum`.
 */
export async function obterCiclo(
  usuarioId: number,
  simulacaoId: number,
  numero: number,
  { fase, agentId, limit, offset, detalhes }: ObterCicloQuery,
) {
  await obterPropria(usuarioId, simulacaoId);
  const ciclo = await prisma.ciclo.findUnique({
    where: { simulacaoId_numero: { simulacaoId, numero } },
  });
  if (!ciclo) throw Errors.notFound("Ciclo não encontrado");

  const filtro = { cicloId: ciclo.id, ...(fase ? { fase } : {}), ...(agentId ? { agentId } : {}) };
  const [totalLogs, logs] = await Promise.all([
    prisma.logCiclo.count({ where: filtro }),
    prisma.logCiclo.findMany({ where: filtro, orderBy: { id: "asc" }, take: limit, skip: offset }),
  ]);

  const { relatorioComum, ...dados } = ciclo;
  return {
    ...resumir(dados),
    relatorioComum,
    totalLogs,
    limit,
    offset,
    logs: logs.map((log) => ({
      id: log.id,
      agentId: log.agentId,
      fase: log.fase,
      acao: log.acao,
      valido: log.valido,
      ...(log.fase !== "PERCEPCAO" || detalhes ? { detalhes: log.detalhes } : {}),
      latenciaMs: log.latenciaMs,
      tokensEntrada: log.tokensEntrada,
      tokensSaida: log.tokensSaida,
    })),
  };
}

interface LinhaCiclos {
  total: bigint;
  concluidos: bigint;
  falhos: bigint;
  duracao_media_ms: number | null;
  duracao_p95_ms: number | null;
}

interface LinhaDecisoes {
  total: bigint;
  validas: bigint;
  latencia_media_ms: number | null;
  latencia_p95_ms: number | null;
  tokens_entrada: bigint | null;
  tokens_saida: bigint | null;
}

const arredondar = (valor: number | null) => (valor === null ? null : Math.round(valor * 100) / 100);

/** Métricas de desempenho e confiabilidade da simulação (base para a avaliação do artigo). */
export async function obterMetricas(usuarioId: number, simulacaoId: number) {
  await obterPropria(usuarioId, simulacaoId);

  const [ciclos] = await prisma.$queryRaw<LinhaCiclos[]>`
    SELECT
      count(*)                                         AS total,
      count(*) FILTER (WHERE situacao = 'CONCLUIDO')   AS concluidos,
      count(*) FILTER (WHERE situacao = 'FALHOU')      AS falhos,
      (avg(extract(epoch FROM (fim - inicio)) * 1000)
        FILTER (WHERE situacao = 'CONCLUIDO'))::float8 AS duracao_media_ms,
      (percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (fim - inicio)) * 1000)
        FILTER (WHERE situacao = 'CONCLUIDO'))::float8 AS duracao_p95_ms
    FROM ciclo
    WHERE simulacao_id = ${simulacaoId}`;

  const [decisoes] = await prisma.$queryRaw<LinhaDecisoes[]>`
    SELECT
      count(*)                                                        AS total,
      count(*) FILTER (WHERE l.valido)                                AS validas,
      avg(l.latencia_ms)::float8                                      AS latencia_media_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY l.latencia_ms)::float8 AS latencia_p95_ms,
      sum(l.tokens_entrada)                                           AS tokens_entrada,
      sum(l.tokens_saida)                                             AS tokens_saida
    FROM logs l
    JOIN ciclo c ON c.id = l.ciclo_id
    WHERE c.simulacao_id = ${simulacaoId} AND l.fase = 'DECISAO'`;

  const totalCiclos = Number(ciclos?.total ?? 0);
  const concluidos = Number(ciclos?.concluidos ?? 0);
  const totalDecisoes = Number(decisoes?.total ?? 0);
  const validas = Number(decisoes?.validas ?? 0);

  return {
    ciclos: {
      total: totalCiclos,
      concluidos,
      falhos: Number(ciclos?.falhos ?? 0),
      taxaSucesso: totalCiclos > 0 ? concluidos / totalCiclos : null,
      duracaoMediaMs: arredondar(ciclos?.duracao_media_ms ?? null),
      duracaoP95Ms: arredondar(ciclos?.duracao_p95_ms ?? null),
    },
    decisoes: {
      total: totalDecisoes,
      validas,
      taxaValidas: totalDecisoes > 0 ? validas / totalDecisoes : null,
      latenciaMediaMs: arredondar(decisoes?.latencia_media_ms ?? null),
      latenciaP95Ms: arredondar(decisoes?.latencia_p95_ms ?? null),
      tokensEntrada: Number(decisoes?.tokens_entrada ?? 0),
      tokensSaida: Number(decisoes?.tokens_saida ?? 0),
    },
  };
}
