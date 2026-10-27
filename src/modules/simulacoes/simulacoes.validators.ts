import { z } from "zod";
import { env } from "../../config/env.ts";

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const numeroCicloParamSchema = idParamSchema.extend({
  numero: z.coerce.number().int().positive(),
});

export const criarSimulacaoSchema = z.object({
  nome: z.string().trim().min(2, "Nome deve ter pelo menos 2 caracteres").max(120),
  intervaloSegundos: z.coerce
    .number()
    .int()
    .min(1, "Intervalo mínimo de 1 segundo")
    .max(24 * 60 * 60, "Intervalo máximo de 24 horas")
    .default(env.cicloIntervaloPadraoSegundos),
});

export const criarAgenteSchema = z.object({
  nomeAgente: z.string().trim().min(2).max(80),
  provedorLlm: z.string().trim().toLowerCase().min(1).max(40),
  promptAlma: z.string().trim().min(10, "Prompt-Alma deve ter pelo menos 10 caracteres").max(8000),
});

export const listarCiclosQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CriarSimulacaoInput = z.infer<typeof criarSimulacaoSchema>;
export type CriarAgenteInput = z.infer<typeof criarAgenteSchema>;
export type ListarCiclosQuery = z.infer<typeof listarCiclosQuerySchema>;
