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
        target: z.string().min(1).optional(),
        value: z.number().finite().optional(),
      })
      .catchall(z.unknown())
      .default({}),
    rationale: z.string().trim().min(1, "rationale é obrigatório para auditoria"),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((resposta, ctx) => {
    if (resposta.action !== "OCIOSO" && !resposta.parameters.target) {
      ctx.addIssue({
        code: "custom",
        path: ["parameters", "target"],
        message: `parameters.target é obrigatório para ${resposta.action}`,
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

/** Relatório de estado montado na fase de percepção, um por agente. */
export interface RelatorioEstado {
  simulacaoId: number;
  ciclo: number;
  dia: number;
  geradoEm: string;
  agente: AgenteResumo;
  ecossistema: {
    totalAgentes: number;
    ranking: AgenteResumo[];
  };
  topicosEmAlta: string[];
  acoesImpactantesCicloAnterior: AcaoImpactante[];
  /** Vazio até existir a tabela de publicações (Etapas seguintes). */
  publicacoesRecentes: unknown[];
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
  tentativas: number;
  latenciaMs: number;
  tokensEntrada: number;
  tokensSaida: number;
}
