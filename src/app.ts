import crypto from "node:crypto";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { serve as swaggerServe, setup as swaggerSetup } from "swagger-ui-express";
import { env } from "./config/env.ts";
import { prisma } from "./db/prisma.ts";
import { redis } from "./redis/client.ts";
import { isRabbitMQConnected, rabbitMQHabilitado } from "./queue/rabbitmq.ts";
import { authGuard } from "./middleware/authGuard.ts";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.ts";
import { authRouter } from "./modules/auth/auth.routes.ts";
import { simulacoesRouter } from "./modules/simulacoes/simulacoes.routes.ts";
import { openApiSpec } from "./docs/openapi.ts";
import { logger } from "./utils/logger.ts";

export const app = express();

// Atrás de proxy reverso, sem isto todos os clientes compartilham o IP do proxy no rate limit.
app.set("trust proxy", env.trustProxy);

app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const recebido = req.headers["x-request-id"];
      const id = typeof recebido === "string" && /^[\w.-]{1,128}$/.test(recebido) ? recebido : crypto.randomUUID();
      res.setHeader("x-request-id", id);
      return id;
    },
    autoLogging: { ignore: (req) => req.url === "/health" },
  }),
);
app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigins.length > 0 ? env.corsOrigins : false,
    credentials: true,
  }),
);
app.use(express.json({ limit: "100kb" }));

type Estado = "ok" | "down";

async function verificarServicos(): Promise<Record<string, Estado>> {
  const services: Record<string, Estado> = { postgres: "down", redis: "down" };

  try {
    await prisma.$queryRaw`SELECT 1`;
    services.postgres = "ok";
  } catch {
    services.postgres = "down";
  }

  try {
    const pong = await redis.ping();
    services.redis = pong === "PONG" ? "ok" : "down";
  } catch {
    services.redis = "down";
  }

  // Fora dos testes o processo conecta ao broker (com reconexão automática).
  if (rabbitMQHabilitado()) services.rabbitmq = isRabbitMQConnected() ? "ok" : "down";

  return services;
}

/** Público: só diz se a API está saudável, sem revelar o estado de cada serviço. */
app.get("/health", async (_req, res) => {
  const services = await verificarServicos();
  const allOk = Object.values(services).every((status) => status === "ok");
  res.status(allOk ? 200 : 503).json({ status: allOk ? "ok" : "degraded" });
});

/** Detalhe por serviço, só para usuários autenticados. */
app.get("/health/detalhes", authGuard, async (_req, res) => {
  const services = await verificarServicos();
  const allOk = Object.values(services).every((status) => status === "ok");
  res.status(allOk ? 200 : 503).json({ status: allOk ? "ok" : "degraded", services });
});

if (env.docsHabilitado) {
  app.use(
    "/docs",
    helmet({ contentSecurityPolicy: false }),
    swaggerServe,
    swaggerSetup(openApiSpec),
  );
}

app.use(authRouter);
app.use(simulacoesRouter);

app.use(notFoundHandler);
app.use(errorHandler);
