import { Redis } from "ioredis";
import { env } from "../config/env.ts";

export const redis = new Redis(env.redisUrl, {
  lazyConnect: false,
  maxRetriesPerRequest: 3,
});

redis.on("error", (error: Error) => {
  console.error("Erro na conexão com o Redis:", error.message);
});
