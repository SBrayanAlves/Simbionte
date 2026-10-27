/**
 * Teste de contrato do LlmGateway, reutilizável por qualquer implementação (ex.: um gateway
 * real da OpenAI ou da Anthropic): a implementação precisa respeitar `signal`.
 *
 *   await verificarContratoGateway(new MeuGateway(), { promptAlmaLento: "..." });
 */
import assert from "node:assert/strict";
import type { LlmGateway, PedidoDecisao } from "../src/modules/ciclos/tipos.ts";

const PRAZO_REACAO_MS = 1_000;

function pedido(promptAlma: string, signal: AbortSignal): PedidoDecisao {
  const relatorio = {
    simulacaoId: 1,
    ciclo: 1,
    dia: 1,
    geradoEm: new Date().toISOString(),
    agente: { id: 1, nome: "Contrato", saldoMd: 1000, trustScore: 0.5 },
    ecossistema: { totalAgentes: 1, ranking: [] },
    topicosEmAlta: [],
    acoesImpactantesCicloAnterior: [],
    publicacoesRecentes: [],
  };
  return {
    agente: { id: 1, nome: "Contrato", provedorLlm: "contrato", promptAlma, chaveApiCriptografada: null },
    relatorio,
    instrucaoEstrategica: promptAlma,
    prompt: { system: promptAlma, user: JSON.stringify(relatorio) },
    signal,
  };
}

async function rejeitaRapido(promessa: Promise<unknown>, descricao: string) {
  let timer: NodeJS.Timeout | undefined;
  const prazo = new Promise<"prazo">((resolve) => {
    timer = setTimeout(() => resolve("prazo"), PRAZO_REACAO_MS);
  });
  try {
    const resultado = await Promise.race([promessa.then(() => "resolveu", () => "rejeitou"), prazo]);
    assert.equal(resultado, "rejeitou", descricao);
  } finally {
    clearTimeout(timer);
  }
}

export async function verificarContratoGateway(
  gateway: LlmGateway,
  opcoes: { promptAlmaLento?: string } = {},
): Promise<void> {
  const jaAbortado = new AbortController();
  jaAbortado.abort();
  await rejeitaRapido(
    gateway.decidir(pedido("Estratégia de contrato", jaAbortado.signal)),
    "com signal já abortado, decidir() deve rejeitar sem chamar o provedor",
  );

  const emVoo = new AbortController();
  const chamada = gateway.decidir(pedido(opcoes.promptAlmaLento ?? "Estratégia [[STUB:LENTO]]", emVoo.signal));
  setTimeout(() => emVoo.abort(), 20);
  await rejeitaRapido(chamada, "abortar durante a chamada deve rejeitar em até 1 s");
}
