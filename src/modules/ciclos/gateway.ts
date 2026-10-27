import { env } from "../../config/env.ts";
import { ACOES } from "./tipos.ts";
import type { LlmGateway, PedidoDecisao, RespostaGateway } from "./tipos.ts";

/** Estimativa grosseira (~4 caracteres por token); só para o gateway de simulação. */
function estimarTokens(texto: string): number {
  return Math.max(1, Math.ceil(texto.length / 4));
}

function esperar(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Requisição abortada"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Requisição abortada"));
      },
      { once: true },
    );
  });
}

/**
 * Gateway de simulação: não chama nenhum provedor real. Gera respostas determinísticas
 * (a mesma combinação agente + ciclo sempre produz a mesma ação), o que permite medir o
 * orquestrador isoladamente do custo e da variabilidade dos LLMs.
 *
 * Ganchos de teste, ativados por marcadores no Prompt-Alma do agente:
 *   [[STUB:INVALIDO]]  responde um texto que não é JSON válido
 *   [[STUB:ERRO]]      lança erro (provedor indisponível)
 *   [[STUB:LENTO]]     não responde até o timeout abortar a requisição
 *   [[STUB:ATRASO=ms]] responde após `ms` milissegundos
 */
export class StubLlmGateway implements LlmGateway {
  async decidir(pedido: PedidoDecisao): Promise<RespostaGateway> {
    const { agente, relatorio, prompt, signal } = pedido;
    if (signal.aborted) throw new Error("Requisição abortada");
    const tokensEntrada = estimarTokens(prompt.system + prompt.user);

    const atraso = /\[\[STUB:ATRASO=(\d+)\]\]/.exec(agente.promptAlma);
    if (atraso) await esperar(Number(atraso[1]), signal);

    if (agente.promptAlma.includes("[[STUB:LENTO]]")) await esperar(60 * 60 * 1000, signal);
    if (agente.promptAlma.includes("[[STUB:ERRO]]")) throw new Error("Provedor de LLM indisponível (stub)");
    if (agente.promptAlma.includes("[[STUB:INVALIDO]]")) {
      return { conteudo: "não sei o que fazer neste ciclo", tokensEntrada, tokensSaida: 8 };
    }

    const indice = (agente.id * 31 + relatorio.ciclo * 17) % ACOES.length;
    const acao = ACOES[indice] ?? "OCIOSO";
    const alvo = `topico-${(agente.id + relatorio.ciclo) % 4}`;

    const conteudo = JSON.stringify({
      agent_id: String(agente.id),
      timestamp: new Date().toISOString(),
      action: acao,
      parameters: acao === "OCIOSO" ? {} : { target: alvo, value: (indice + 1) * 10 },
      rationale: `Ação simulada ${acao} no ciclo ${relatorio.ciclo} com saldo ${relatorio.agente.saldoMd} MD.`,
      metadata: { gateway: "stub" },
    });

    return { conteudo, tokensEntrada, tokensSaida: estimarTokens(conteudo) };
  }
}

/** Seleciona o gateway pela variável LLM_GATEWAY. Novos provedores entram aqui. */
export function criarGateway(nome: string = env.llmGateway): LlmGateway {
  if (nome === "stub") return new StubLlmGateway();
  throw new Error(
    `LLM_GATEWAY="${nome}" não está implementado. Use "stub" ou registre o módulo de conexão em gateway.ts.`,
  );
}
