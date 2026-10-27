import { env } from "./config/env.ts";
import { prisma } from "./db/prisma.ts";
import { fecharTravas } from "./db/travas.ts";
import { redis } from "./redis/client.ts";
import { closeRabbitMQ, connectRabbitMQ } from "./queue/rabbitmq.ts";
import { orquestrador } from "./modules/ciclos/orquestrador.ts";
import { apagarLogsPercepcaoAntigos } from "./modules/ciclos/retencao.ts";
import { logger } from "./utils/logger.ts";
import { instalarCicloDeVida } from "./utils/processo.ts";

/**
 * Worker do Game Loop (processo separado da API, como define a arquitetura da Etapa 2).
 * Pode haver mais de um: a trava por simulação no Postgres garante um ciclo por vez.
 */
const UMA_HORA_MS = 60 * 60 * 1000;
const log = logger.child({ componente: "worker" });

void connectRabbitMQ();

let timerRetencao: NodeJS.Timeout | null = null;

async function retencao() {
  try {
    const apagados = await apagarLogsPercepcaoAntigos(env.logsPercepcaoRetencaoDias);
    if (apagados > 0) log.info({ apagados, dias: env.logsPercepcaoRetencaoDias }, "logs de percepção antigos apagados");
  } catch (err) {
    log.error({ err }, "falha na retenção de logs");
  }
  timerRetencao = setTimeout(() => void retencao(), UMA_HORA_MS);
}

instalarCicloDeVida("worker", async () => {
  if (timerRetencao) clearTimeout(timerRetencao);
  await orquestrador.encerrar();
  await Promise.allSettled([prisma.$disconnect(), redis.quit(), closeRabbitMQ(), fecharTravas()]);
});

await orquestrador.retomar();
orquestrador.iniciarSincronizacao(env.workerSincronizacaoSegundos * 1000);
void retencao();
log.info({ ambiente: env.nodeEnv, sincronizacaoSegundos: env.workerSincronizacaoSegundos }, "worker de ciclos rodando");
