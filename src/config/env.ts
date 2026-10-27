import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z.string().default(""),
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
  REDIS_URL: z.string().min(1, "REDIS_URL é obrigatória"),
  RABBITMQ_URL: z.string().min(1, "RABBITMQ_URL é obrigatória"),
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET precisa ter pelo menos 16 caracteres"),
  JWT_ACCESS_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  // Orquestrador de ciclos (Etapa 5)
  CICLO_INTERVALO_PADRAO_SEGUNDOS: z.coerce.number().int().positive().default(300),
  DECISAO_CONCORRENCIA: z.coerce.number().int().positive().default(5),
  DECISAO_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  DECISAO_TENTATIVAS: z.coerce.number().int().min(1).default(2),
  LLM_GATEWAY: z.string().default("stub"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Variáveis de ambiente inválidas:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const data = parsed.data;

export const env = {
  nodeEnv: data.NODE_ENV,
  isProduction: data.NODE_ENV === "production",
  port: data.PORT,
  corsOrigins: data.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  databaseUrl: data.DATABASE_URL,
  redisUrl: data.REDIS_URL,
  rabbitmqUrl: data.RABBITMQ_URL,
  jwtAccessSecret: data.JWT_ACCESS_SECRET,
  jwtAccessTtlMinutes: data.JWT_ACCESS_TTL_MINUTES,
  jwtRefreshTtlDays: data.JWT_REFRESH_TTL_DAYS,
  cicloIntervaloPadraoSegundos: data.CICLO_INTERVALO_PADRAO_SEGUNDOS,
  decisaoConcorrencia: data.DECISAO_CONCORRENCIA,
  decisaoTimeoutMs: data.DECISAO_TIMEOUT_MS,
  decisaoTentativas: data.DECISAO_TENTATIVAS,
  llmGateway: data.LLM_GATEWAY,
};
