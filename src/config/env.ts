import "dotenv/config";
import { z } from "zod";
import { urlBancoTeste, urlRedisTeste } from "./ambienteTeste.ts";

/** Valores de exemplo que já foram públicos no repositório: nunca valem em produção. */
const SEGREDOS_DE_EXEMPLO = ["troque-este-segredo-em-producao"];
const PLACEHOLDER = "troque-me";

const inteiroOpcional = z.coerce.number().int().min(0).optional();

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    DOCS_HABILITADO: z.enum(["true", "false"]).optional(),
    CORS_ORIGINS: z.string().default(""),
    DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
    REDIS_URL: z.string().min(1, "REDIS_URL é obrigatória"),
    RABBITMQ_URL: z.string().min(1, "RABBITMQ_URL é obrigatória"),
    TEST_DATABASE_URL: z.string().optional(),
    TEST_REDIS_URL: z.string().optional(),
    JWT_ACCESS_SECRET: z
      .string()
      .min(16, "JWT_ACCESS_SECRET precisa ter pelo menos 16 caracteres (gere com `npm run setup`)"),
    JWT_ACCESS_TTL_MINUTES: z.coerce.number().int().positive().default(15),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
    JWT_ISSUER: z.string().min(1).default("simbionte"),
    JWT_AUDIENCE: z.string().min(1).default("simbionte-api"),
    // Rate limit
    RATE_LIMIT_STORE: z.enum(["memory", "redis"]).optional(),
    RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(20),
    RATE_LIMIT_REGISTER_MAX: z.coerce.number().int().positive().default(20),
    RATE_LIMIT_REFRESH_MAX: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_CICLO_MANUAL_MAX: z.coerce.number().int().positive().default(10),
    // Cotas
    MAX_SIMULACOES_POR_USUARIO: z.coerce.number().int().positive().default(5),
    MAX_AGENTES_POR_SIMULACAO: z.coerce.number().int().positive().default(50),
    INTERVALO_MINIMO_SEGUNDOS: inteiroOpcional,
    // Orquestrador de ciclos (Etapa 5)
    CICLO_INTERVALO_PADRAO_SEGUNDOS: z.coerce.number().int().positive().default(300),
    DECISAO_CONCORRENCIA: z.coerce.number().int().positive().default(5),
    DECISAO_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    DECISAO_TENTATIVAS: z.coerce.number().int().min(1).default(2),
    LLM_GATEWAY: z.string().default("stub"),
    // Worker
    WORKER_SINCRONIZACAO_SEGUNDOS: z.coerce.number().int().positive().default(5),
    LOGS_PERCEPCAO_RETENCAO_DIAS: z.coerce.number().int().min(0).default(30),
  })
  .superRefine((dados, ctx) => {
    if (dados.NODE_ENV !== "production") return;

    const segredo = dados.JWT_ACCESS_SECRET;
    if (segredo.length < 32) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_ACCESS_SECRET"],
        message: "Em produção o JWT_ACCESS_SECRET precisa ter pelo menos 32 caracteres",
      });
    }
    if (SEGREDOS_DE_EXEMPLO.includes(segredo) || segredo.includes(PLACEHOLDER)) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_ACCESS_SECRET"],
        message: "Em produção o JWT_ACCESS_SECRET não pode ser o valor de exemplo",
      });
    }
    for (const chave of ["DATABASE_URL", "REDIS_URL", "RABBITMQ_URL"] as const) {
      if (dados[chave].includes(PLACEHOLDER)) {
        ctx.addIssue({
          code: "custom",
          path: [chave],
          message: `Em produção ${chave} não pode usar a senha de exemplo`,
        });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Variáveis de ambiente inválidas:", z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

const data = parsed.data;
const isProduction = data.NODE_ENV === "production";
const isTest = data.NODE_ENV === "test";

export const env = {
  nodeEnv: data.NODE_ENV,
  isProduction,
  isTest,
  port: data.PORT,
  trustProxy: data.TRUST_PROXY,
  logLevel: data.LOG_LEVEL,
  docsHabilitado: data.DOCS_HABILITADO ? data.DOCS_HABILITADO === "true" : !isProduction,
  corsOrigins: data.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  databaseUrl: isTest ? (data.TEST_DATABASE_URL ?? urlBancoTeste(data.DATABASE_URL)) : data.DATABASE_URL,
  redisUrl: isTest ? (data.TEST_REDIS_URL ?? urlRedisTeste(data.REDIS_URL)) : data.REDIS_URL,
  rabbitmqUrl: data.RABBITMQ_URL,
  jwtAccessSecret: data.JWT_ACCESS_SECRET,
  jwtAccessTtlMinutes: data.JWT_ACCESS_TTL_MINUTES,
  jwtRefreshTtlDays: data.JWT_REFRESH_TTL_DAYS,
  jwtIssuer: data.JWT_ISSUER,
  jwtAudience: data.JWT_AUDIENCE,
  rateLimitStore: data.RATE_LIMIT_STORE ?? (isProduction ? "redis" : "memory"),
  rateLimitLoginMax: data.RATE_LIMIT_LOGIN_MAX,
  rateLimitRegisterMax: data.RATE_LIMIT_REGISTER_MAX,
  rateLimitRefreshMax: data.RATE_LIMIT_REFRESH_MAX,
  rateLimitCicloManualMax: data.RATE_LIMIT_CICLO_MANUAL_MAX,
  maxSimulacoesPorUsuario: data.MAX_SIMULACOES_POR_USUARIO,
  maxAgentesPorSimulacao: data.MAX_AGENTES_POR_SIMULACAO,
  intervaloMinimoSegundos: data.INTERVALO_MINIMO_SEGUNDOS ?? (isProduction ? 30 : 1),
  cicloIntervaloPadraoSegundos: data.CICLO_INTERVALO_PADRAO_SEGUNDOS,
  decisaoConcorrencia: data.DECISAO_CONCORRENCIA,
  decisaoTimeoutMs: data.DECISAO_TIMEOUT_MS,
  decisaoTentativas: data.DECISAO_TENTATIVAS,
  llmGateway: data.LLM_GATEWAY,
  workerSincronizacaoSegundos: data.WORKER_SINCRONIZACAO_SEGUNDOS,
  logsPercepcaoRetencaoDias: data.LOGS_PERCEPCAO_RETENCAO_DIAS,
};
