import { z } from "zod";
import { env } from "../../config/env.ts";
import { TEXTO_COMPARTILHADO } from "../ciclos/tipos.ts";

/** Maior valor de uma coluna INTEGER do Postgres; acima disso a consulta falharia com 500. */
const INT4_MAX = 2_147_483_647;
const idPositivo = z.coerce.number().int().positive().max(INT4_MAX);

const booleanoQuery = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();

export const idParamSchema = z.object({
  id: idPositivo,
});

export const numeroCicloParamSchema = idParamSchema.extend({
  numero: idPositivo,
});

export const criarSimulacaoSchema = z.object({
  nome: z.string().trim().min(2, "Nome deve ter pelo menos 2 caracteres").max(120),
  intervaloSegundos: z.coerce
    .number()
    .int()
    .min(1, "Intervalo mínimo de 1 segundo")
    .max(24 * 60 * 60, "Intervalo máximo de 24 horas")
    .default(Math.max(env.cicloIntervaloPadraoSegundos, env.intervaloMinimoSegundos)),
});

export const criarAgenteSchema = z.object({
  // O nome aparece no relatório de percepção dos outros agentes: mesma regra do `target`.
  nomeAgente: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(TEXTO_COMPARTILHADO, "nomeAgente aceita só letras, números, espaço e _ . , -"),
  provedorLlm: z.string().trim().toLowerCase().min(1).max(40),
  promptAlma: z.string().trim().min(10, "Prompt-Alma deve ter pelo menos 10 caracteres").max(8000),
});

export const listarCiclosQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(INT4_MAX).default(0),
});

export const obterCicloQuerySchema = z.object({
  fase: z.enum(["PERCEPCAO", "DECISAO"]).optional(),
  agentId: idPositivo.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(INT4_MAX).default(0),
  /** Inclui `detalhes` dos logs de percepção (omitidos por padrão para aliviar a resposta). */
  detalhes: booleanoQuery,
});

export type CriarSimulacaoInput = z.infer<typeof criarSimulacaoSchema>;
export type CriarAgenteInput = z.infer<typeof criarAgenteSchema>;
export type ListarCiclosQuery = z.infer<typeof listarCiclosQuerySchema>;
export type ObterCicloQuery = z.infer<typeof obterCicloQuerySchema>;
