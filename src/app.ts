import express from "express";
import helmet from "helmet";
import cors from "cors";
import { serve as swaggerServe, setup as swaggerSetup } from "swagger-ui-express";
import { env } from "./config/env.ts";
import { prisma } from "./db/prisma.ts";
import { redis } from "./redis/client.ts";
import { isRabbitMQConnected } from "./queue/rabbitmq.ts";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.ts";
import { authRouter } from "./modules/auth/auth.routes.ts";
import { simulacoesRouter } from "./modules/simulacoes/simulacoes.routes.ts";
import { openApiSpec } from "./docs/openapi.ts";

export const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigins.length > 0 ? env.corsOrigins : false,
    credentials: true,
  }),
);
app.use(express.json());

app.get("/health", async (_req, res) => {
  const services: Record<string, "ok" | "down"> = {
    postgres: "down",
    redis: "down",
    rabbitmq: "down",
  };

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

  services.rabbitmq = isRabbitMQConnected() ? "ok" : "down";

  const allOk = Object.values(services).every((status) => status === "ok");
  res.status(allOk ? 200 : 503).json({ status: allOk ? "ok" : "degraded", services });
});

app.use(
  "/docs",
  helmet({ contentSecurityPolicy: false }),
  swaggerServe,
  swaggerSetup(openApiSpec),
);

app.use(authRouter);
app.use(simulacoesRouter);

app.use(notFoundHandler);
app.use(errorHandler);
