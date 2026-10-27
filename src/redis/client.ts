import { Redis } from "ioredis";
import { env } from "../config/env.ts";
import { logger } from "../utils/logger.ts";

export const redis = new Redis(env.redisUrl, {
  lazyConnect: false,
  maxRetriesPerRequest: 3,
});

redis.on("error", (error: Error) => {
  logger.error({ err: error }, "erro na conexão com o Redis");
});
