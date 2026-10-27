import type { Request } from "express";
import { rateLimit, type Options } from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { env } from "../config/env.ts";
import { redis } from "../redis/client.ts";

const QUINZE_MINUTOS = 15 * 60 * 1000;

/**
 * Em produção o contador vive no Redis, para valer entre várias instâncias da API.
 * Fora dela fica na memória do processo (testes não compartilham contadores entre execuções).
 */
function store(prefixo: string): Pick<Options, "store"> | Record<string, never> {
  if (env.rateLimitStore !== "redis") return {};
  return {
    store: new RedisStore({
      prefix: `rl:${prefixo}:`,
      sendCommand: (comando: string, ...args: string[]) =>
        redis.call(comando, ...args) as Promise<RedisReply>,
    }),
  };
}

function limitador(prefixo: string, opcoes: Partial<Options>) {
  return rateLimit({
    windowMs: QUINZE_MINUTOS,
    standardHeaders: true,
    legacyHeaders: false,
    ...store(prefixo),
    message: {
      error: {
        code: "too_many_requests",
        message: "Muitas tentativas. Tente novamente mais tarde.",
      },
    },
    ...opcoes,
  });
}

export const registerRateLimit = limitador("register", { limit: env.rateLimitRegisterMax });

/** Só falhas contam: um laboratório atrás do mesmo NAT não trava com logins legítimos. */
export const loginRateLimit = limitador("login", {
  limit: env.rateLimitLoginMax,
  skipSuccessfulRequests: true,
});

export const refreshRateLimit = limitador("refresh", { limit: env.rateLimitRefreshMax });

/** Execução manual de ciclo: cada chamada custa `agentes x tentativas` chamadas ao LLM. */
export const cicloManualRateLimit = limitador("ciclo-manual", {
  windowMs: 60 * 1000,
  limit: env.rateLimitCicloManualMax,
  keyGenerator: (req: Request) => `usuario:${req.usuarioId ?? "anonimo"}`,
});
