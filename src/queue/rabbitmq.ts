import amqp, { type ChannelModel } from "amqplib";
import { env } from "../config/env.ts";

let connection: ChannelModel | null = null;
let connecting: Promise<ChannelModel> | null = null;

export async function connectRabbitMQ(): Promise<ChannelModel> {
  if (connection) return connection;
  if (connecting) return connecting;

  connecting = amqp.connect(env.rabbitmqUrl).then((conn) => {
    connection = conn;
    connecting = null;

    conn.on("error", (error: Error) => {
      console.error("Erro na conexão com o RabbitMQ:", error.message);
      connection = null;
    });
    conn.on("close", () => {
      connection = null;
    });

    return conn;
  });

  return connecting;
}

export function isRabbitMQConnected(): boolean {
  return connection !== null;
}
