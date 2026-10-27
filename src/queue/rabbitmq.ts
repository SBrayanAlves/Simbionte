import amqp, { type Channel, type ChannelModel } from "amqplib";
import { env } from "../config/env.ts";
import { logger } from "../utils/logger.ts";

/**
 * Conexão com o RabbitMQ, com reconexão automática (espera de 1 s dobrando até 30 s).
 *
 * Papel da fila: o worker publica eventos do ciclo no exchange `simbionte.eventos` (topic),
 * para o Subgrupo B atualizar o front-end (ex.: via WebSocket) sem consultar a API em laço.
 *   ciclo.concluido / ciclo.falhou  -> { simulacaoId, numero, situacao, decisoesValidas, ... }
 *   simulacao.situacao              -> { simulacaoId, situacao }
 * A publicação é "melhor esforço": sem broker, o evento é descartado e o ciclo segue normal.
 */
export const EXCHANGE_EVENTOS = "simbionte.eventos";

const ESPERA_INICIAL_MS = 1_000;
const ESPERA_MAXIMA_MS = 30_000;

let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let connecting: Promise<void> | null = null;
let timerReconexao: NodeJS.Timeout | null = null;
let espera = ESPERA_INICIAL_MS;
let encerrando = false;
let habilitado = false;

const log = logger.child({ componente: "rabbitmq" });

function agendarReconexao() {
  if (encerrando || timerReconexao) return;
  const atraso = espera;
  espera = Math.min(espera * 2, ESPERA_MAXIMA_MS);
  log.warn({ atrasoMs: atraso }, "RabbitMQ indisponível; nova tentativa agendada");
  timerReconexao = setTimeout(() => {
    timerReconexao = null;
    void conectar();
  }, atraso);
  timerReconexao.unref();
}

async function conectar(): Promise<void> {
  if (connection || connecting || encerrando) return connecting ?? undefined;
  connecting = (async () => {
    try {
      const conn = await amqp.connect(env.rabbitmqUrl);
      const ch = await conn.createChannel();
      await ch.assertExchange(EXCHANGE_EVENTOS, "topic", { durable: true });

      conn.on("error", (err: Error) => log.error({ err }, "erro na conexão com o RabbitMQ"));
      conn.on("close", () => {
        connection = null;
        channel = null;
        agendarReconexao();
      });

      connection = conn;
      channel = ch;
      espera = ESPERA_INICIAL_MS;
      log.info("conectado ao RabbitMQ");
    } catch (err) {
      log.error({ err }, "não foi possível conectar ao RabbitMQ");
      agendarReconexao();
    } finally {
      connecting = null;
    }
  })();
  return connecting;
}

/** Liga a conexão (e a reconexão automática). Nunca rejeita: falhas são registradas e retentadas. */
export async function connectRabbitMQ(): Promise<void> {
  habilitado = true;
  encerrando = false;
  await conectar();
}

export function isRabbitMQConnected(): boolean {
  return connection !== null && channel !== null;
}

/** Indica se este processo usa o RabbitMQ (API e worker sim; testes não). */
export function rabbitMQHabilitado(): boolean {
  return habilitado;
}

export function publicarEvento(rota: string, payload: Record<string, unknown>): boolean {
  if (!channel) return false;
  try {
    return channel.publish(EXCHANGE_EVENTOS, rota, Buffer.from(JSON.stringify(payload)), {
      contentType: "application/json",
      persistent: true,
      timestamp: Math.floor(Date.now() / 1000),
    });
  } catch (err) {
    log.warn({ err, rota }, "falha ao publicar evento");
    return false;
  }
}

export async function closeRabbitMQ(): Promise<void> {
  encerrando = true;
  if (timerReconexao) clearTimeout(timerReconexao);
  timerReconexao = null;
  const conn = connection;
  connection = null;
  channel = null;
  if (conn) await conn.close().catch(() => undefined);
}
