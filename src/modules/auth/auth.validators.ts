import { z } from "zod";

export const registerSchema = z.object({
  nome: z.string().trim().min(2, "Nome deve ter pelo menos 2 caracteres").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  senha: z.string().min(8, "Senha deve ter pelo menos 8 caracteres").max(128),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  senha: z.string().min(1, "Senha é obrigatória"),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "refreshToken é obrigatório"),
});

export const logoutSchema = refreshSchema;

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
