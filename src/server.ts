import { app } from "./app.ts";
import { env } from "./config/env.ts";
import { prisma } from "./db/prisma.ts";
import { fecharTravas } from "./db/travas.ts";
import { redis } from "./redis/client.ts";
import { closeRabbitMQ, connectRabbitMQ } from "./queue/rabbitmq.ts";
import { orquestrador } from "./modules/ciclos/orquestrador.ts";
import { logger } from "./utils/logger.ts";
import { instalarCicloDeVida } from "./utils/processo.ts";

// API HTTP. O laço contínuo dos ciclos roda no worker (`npm run worker`); aqui só a
// execução manual de um ciclo (POST /simulacoes/:id/ciclos/executar).
void connectRabbitMQ();

const server = app.listen(env.port, () => {
  logger.info({ porta: env.port, ambiente: env.nodeEnv }, "Simbionte API rodando");
});

instalarCicloDeVida("api", async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await orquestrador.encerrar();
  await Promise.allSettled([prisma.$disconnect(), redis.quit(), closeRabbitMQ(), fecharTravas()]);
});
