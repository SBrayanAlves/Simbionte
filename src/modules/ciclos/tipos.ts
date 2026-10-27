import { z } from "zod";

/** Ações permitidas ao agente (Documento de Pesquisa, seção 6.2). */
export const ACOES = [
  "CRIAR_CONCEITO",
  "PUBLICAR",
  "VERIFICAR_FATOS",
  "COMENTAR",
  "OCIOSO",
] as const;

export type Acao = (typeof ACOES)[number];

/** Limites de tamanho da resposta de um agente. */
export const LIMITES_RESPOSTA = {
  /** Texto bruto devolvido pelo módulo de conexão. */
  brutoCaracteres: 16_000,
  rationaleCaracteres: 2_000,
  metadataBytes: 4_096,
  parametrosBytes: 4_096,
} as const;

/**
 * Texto que um agente escreve e que OUTROS agentes leem no relatório de percepção
 * (`parameters.target` e `nomeAgente`). Só letras, números, espaço e `_ . , -`, até 64
 * caracteres: sem quebras de linha, aspas, chaves ou sinais que permitam simular um bloco
 * de instruções dentro do prompt da vítima (Prompt Injection cruzado, relatório do Subgrupo D).
 */
export const TEXTO_COMPARTILHADO = /^[\p{L}\p{N} _.,-]{1,64}$/u;

/**
 * Padrões típicos de tentativa de injeção. Um alvo que case é recusado; no restante da
 * resposta o padrão só é registrado em `logs.detalhes.alertas` para o Subgrupo D auditar.
 */
export const PADROES_INJECAO: ReadonlyArray<{ nome: string; regex: RegExp }> = [
  { nome: "ignore-instrucoes", regex: /\b(ignore|ignora|ignorar|desconsider[ea]|esque[cç]a)\b/iu },
  { nome: "prompt-alma", regex: /prompt[\s_-]*alma/iu },
  { nome: "system-prompt", regex: /\b(system\s*prompt|instru[cç][oõ]es?\s+(original|anterior|do\s+sistema))/iu },
  { nome: "transferencia", regex: /\btransf(ira|erir|ere)\b.*\b(saldo|modelas?|md)\b/iu },
];

export function alertasDeInjecao(texto: string): string[] {
  return PADROES_INJECAO.filter((p) => p.regex.test(texto)).map((p) => p.nome);
}

/** Remove de um texto qualquer caractere fora de TEXTO_COMPARTILHADO e limita a 64 caracteres. */
export function textoCompartilhavel(texto: string): string {
  const limpo = texto
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} _.,-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
  return limpo || "sem-nome";
}

const bytesJson = (valor: unknown) => Buffer.byteLength(JSON.stringify(valor ?? null), "utf8");

/**
 * Protocolo de resposta estruturada do agente (Subgrupo C):
 * { agent_id, timestamp, action, parameters: { target, value }, rationale, metadata }.
 *
 * `agent_id` e `timestamp` são opcionais na entrada porque o motor já conhece os dois
 * e sobrescreve com valores próprios; um LLM não é fonte confiável para eles.
 * `parameters` aceita chaves extras (ex.: `tipo`, `conteudo`, `alegacao`) das ações
 * que o documento de pesquisa descreve com mais de um argumento.
 */
export const respostaAgenteSchema = z
  .object({
    agent_id: z.union([z.string(), z.number()]).optional(),
    timestamp: z.string().optional(),
    action: z.enum(ACOES),
    parameters: z
      .object({
        target: z
          .string()
          .trim()
          .regex(TEXTO_COMPARTILHADO, "parameters.target aceita só letras, números, espaço e _ . , - (até 64)")
          .optional(),
        value: z.number().finite().optional(),
      })
      .catchall(z.unknown())
      .default({}),
    rationale: z
      .string()
      .trim()
      .min(1, "rationale é obrigatório para auditoria")
      .max(LIMITES_RESPOSTA.rationaleCaracteres),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((resposta, ctx) => {
    const alvo = resposta.parameters.target;
    if (resposta.action !== "OCIOSO" && !alvo) {
      ctx.addIssue({
        code: "custom",
        path: ["parameters", "target"],
        message: `parameters.target é obrigatório para ${resposta.action}`,
      });
    }
    if (alvo && alertasDeInjecao(alvo).length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["parameters", "target"],
        message: "parameters.target contém padrão de injeção de instruções",
      });
    }
    if (bytesJson(resposta.parameters) > LIMITES_RESPOSTA.parametrosBytes) {
      ctx.addIssue({
        code: "custom",
        path: ["parameters"],
        message: `parameters excede ${LIMITES_RESPOSTA.parametrosBytes} bytes`,
      });
    }
    if (resposta.metadata && bytesJson(resposta.metadata) > LIMITES_RESPOSTA.metadataBytes) {
      ctx.addIssue({
        code: "custom",
        path: ["metadata"],
        message: `metadata excede ${LIMITES_RESPOSTA.metadataBytes} bytes`,
      });
    }
  });

export type RespostaAgente = z.infer<typeof respostaAgenteSchema>;

export interface AgenteResumo {
  id: number;
  nome: string;
  saldoMd: number;
  trustScore: number;
}

export interface AcaoImpactante {
  agentId: number;
  agente: string;
  acao: string;
  alvo: string | null;
}

/** Parte do relatório de percepção igual para todos os agentes do ciclo. */
export interface RelatorioComum {
  simulacaoId: number;
  ciclo: number;
  dia: number;
  geradoEm: string;
  ecossistema: {
    totalAgentes: number;
    ranking: AgenteResumo[];
  };
  topicosEmAlta: string[];
  acoesImpactantesCicloAnterior: AcaoImpactante[];
  /** Vazio até existir a tabela de publicações (Etapas seguintes). */
  publicacoesRecentes: unknown[];
}

/** Relatório de estado montado na fase de percepção, um por agente. */
export interface RelatorioEstado extends RelatorioComum {
  agente: AgenteResumo;
}

export interface AgenteParaDecisao {
  id: number;
  nome: string;
  provedorLlm: string;
  promptAlma: string;
  chaveApiCriptografada: string | null;
}

export interface PedidoDecisao {
  agente: AgenteParaDecisao;
  relatorio: RelatorioEstado;
  /** Instrução estratégica do agente (Prompt-Alma). */
  instrucaoEstrategica: string;
  prompt: { system: string; user: string };
  /**
   * Abortado quando a decisão estoura `DECISAO_TIMEOUT_MS`. A implementação DEVE repassá-lo
   * à chamada HTTP do provedor (ex.: `fetch(url, { signal })`) e parar de trabalhar quando ele
   * disparar: o motor já descartou a resposta, e continuar só gasta tokens e conexões.
   */
  signal: AbortSignal;
}

export interface RespostaGateway {
  /** Texto bruto devolvido pelo LLM, ou objeto já decodificado. */
  conteudo: unknown;
  tokensEntrada: number;
  tokensSaida: number;
}

/**
 * Contrato do "módulo de conexão" (LLM Gateway). Recebe o relatório + instrução
 * estratégica e devolve a resposta bruta, que a fase de decisão valida.
 *
 * Requisitos para uma implementação:
 * - respeitar `pedido.signal` (ver PedidoDecisao.signal) e rejeitar quando abortado;
 * - lançar erro em falha do provedor (o motor faz a nova tentativa);
 * - nunca registrar a chave de API em logs.
 * `tests/gateway.contrato.test.ts` tem um teste de contrato reutilizável para novos gateways.
 */
export interface LlmGateway {
  decidir(pedido: PedidoDecisao): Promise<RespostaGateway>;
}

export interface ResultadoDecisao {
  agentId: number;
  valido: boolean;
  resposta: RespostaAgente;
  bruto: unknown;
  erro: string | null;
  /** Padrões de injeção encontrados na resposta (para o Subgrupo D). */
  alertas: string[];
  tentativas: number;
  latenciaMs: number;
  tokensEntrada: number;
  tokensSaida: number;
}
