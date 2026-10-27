import { ACOES, respostaAgenteSchema } from "./tipos.ts";
import type {
  AgenteParaDecisao,
  LlmGateway,
  RelatorioEstado,
  RespostaAgente,
  ResultadoDecisao,
} from "./tipos.ts";

export interface ConfigDecisao {
  concorrencia: number;
  timeoutMs: number;
  tentativas: number;
}

export interface EntradaDecisao {
  agente: AgenteParaDecisao;
  relatorio: RelatorioEstado;
}

const PERGUNTA =
  "Com base em seu objetivo e no estado atual do ecossistema, qual ação você tomará neste ciclo?";

export function montarPrompt(agente: AgenteParaDecisao, relatorio: RelatorioEstado) {
  const system = [
    agente.promptAlma,
    "",
    "Você é um agente autônomo em uma simulação fictícia. Não faça referência a pessoas, empresas ou governos reais.",
    `Responda APENAS com um objeto JSON, sem texto adicional, no formato: ` +
      `{"action": <uma de ${ACOES.join(" | ")}>, "parameters": {"target": string, "value": number}, ` +
      `"rationale": string, "metadata": object}.`,
    `"parameters.target" é obrigatório para qualquer ação diferente de OCIOSO.`,
  ].join("\n");

  const user = [
    "RELATÓRIO DE ESTADO:",
    JSON.stringify(relatorio, null, 2),
    "",
    PERGUNTA,
  ].join("\n");

  return { system, user };
}

/** Extrai o primeiro objeto JSON de um texto, tolerando cercas de código markdown. */
export function extrairJson(conteudo: unknown): unknown {
  if (typeof conteudo !== "string") return conteudo;
  const texto = conteudo.replace(/```(?:json)?/gi, "").trim();
  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (inicio === -1 || fim <= inicio) throw new Error("Resposta não contém um objeto JSON");
  return JSON.parse(texto.slice(inicio, fim + 1));
}

function validar(conteudo: unknown): RespostaAgente {
  const objeto = extrairJson(conteudo);
  const resultado = respostaAgenteSchema.safeParse(objeto);
  if (!resultado.success) {
    const motivos = resultado.error.issues
      .map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Resposta fora do schema: ${motivos}`);
  }
  return resultado.data;
}

async function comTimeout<T>(
  executar: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const expirou = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Timeout de ${timeoutMs} ms na chamada ao módulo de conexão`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([executar(controller.signal), expirou]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fase de decisão de um agente: envia relatório + instrução estratégica ao módulo de
 * conexão e valida a resposta estruturada. Em caso de resposta inválida, erro ou
 * timeout tenta novamente até `tentativas`; esgotadas, o agente fica OCIOSO naquele
 * ciclo e a falha é registrada, para que um agente com problema nunca trave o ciclo.
 */
export async function decidirAgente(
  gateway: LlmGateway,
  entrada: EntradaDecisao,
  config: ConfigDecisao,
): Promise<ResultadoDecisao> {
  const { agente, relatorio } = entrada;
  const prompt = montarPrompt(agente, relatorio);
  const inicio = Date.now();

  let tokensEntrada = 0;
  let tokensSaida = 0;
  let bruto: unknown = null;
  let erro = "";

  for (let tentativa = 1; tentativa <= config.tentativas; tentativa++) {
    try {
      const resposta = await comTimeout(
        (signal) =>
          gateway.decidir({
            agente,
            relatorio,
            instrucaoEstrategica: agente.promptAlma,
            prompt,
            signal,
          }),
        config.timeoutMs,
      );
      tokensEntrada += resposta.tokensEntrada;
      tokensSaida += resposta.tokensSaida;
      bruto = resposta.conteudo;

      const validada = validar(resposta.conteudo);
      return {
        agentId: agente.id,
        valido: true,
        resposta: {
          ...validada,
          agent_id: String(agente.id),
          timestamp: new Date().toISOString(),
        },
        bruto,
        erro: null,
        tentativas: tentativa,
        latenciaMs: Date.now() - inicio,
        tokensEntrada,
        tokensSaida,
      };
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    agentId: agente.id,
    valido: false,
    resposta: {
      agent_id: String(agente.id),
      timestamp: new Date().toISOString(),
      action: "OCIOSO",
      parameters: {},
      rationale: "Fallback do motor: decisão indisponível ou inválida neste ciclo.",
    },
    bruto,
    erro,
    tentativas: config.tentativas,
    latenciaMs: Date.now() - inicio,
    tokensEntrada,
    tokensSaida,
  };
}

/** Executa as decisões de todos os agentes em paralelo, limitado por `concorrencia`. */
export async function decidirTodos(
  gateway: LlmGateway,
  entradas: EntradaDecisao[],
  config: ConfigDecisao,
): Promise<ResultadoDecisao[]> {
  const resultados: ResultadoDecisao[] = new Array(entradas.length);
  let proximo = 0;

  async function trabalhador() {
    while (true) {
      const indice = proximo++;
      const entrada = entradas[indice];
      if (!entrada) return;
      resultados[indice] = await decidirAgente(gateway, entrada, config);
    }
  }

  const trabalhadores = Math.min(config.concorrencia, entradas.length);
  await Promise.all(Array.from({ length: trabalhadores }, trabalhador));
  return resultados;
}
