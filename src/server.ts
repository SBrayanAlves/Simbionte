import { app } from "./app.ts";
import { env } from "./config/env.ts";
import { prisma } from "./db/prisma.ts";
import { redis } from "./redis/client.ts";
import { connectRabbitMQ } from "./queue/rabbitmq.ts";
import { orquestrador } from "./modules/ciclos/orquestrador.ts";

connectRabbitMQ().catch((error: Error) => {
  console.error("Não foi possível conectar ao RabbitMQ na inicialização:", error.message);
});

const server = app.listen(env.port, () => {
  console.log(`Simbionte backend rodando na porta ${env.port} (${env.nodeEnv})`);
  orquestrador.retomar().catch((error: Error) => {
    console.error("Não foi possível retomar as simulações em execução:", error.message);
  });
});

async function shutdown(signal: string) {
  console.log(`Recebido ${signal}, encerrando com segurança...`);
  server.close();
  await orquestrador.encerrar();
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
