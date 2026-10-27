import { z } from "zod";

/** O bcrypt só considera os primeiros 72 bytes: acima disso, senhas diferentes seriam iguais. */
const BCRYPT_MAX_BYTES = 72;

export const registerSchema = z.object({
  nome: z.string().trim().min(2, "Nome deve ter pelo menos 2 caracteres").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  senha: z
    .string()
    .min(8, "Senha deve ter pelo menos 8 caracteres")
    .refine((senha) => Buffer.byteLength(senha, "utf8") <= BCRYPT_MAX_BYTES, {
      message: `Senha deve ter no máximo ${BCRYPT_MAX_BYTES} bytes (cerca de 72 caracteres sem acento)`,
    }),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  senha: z.string().min(1, "Senha é obrigatória").max(1024),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "refreshToken é obrigatório").max(512),
});

export const logoutSchema = refreshSchema;

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
