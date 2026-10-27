import { pino } from "pino";
import { env } from "../config/env.ts";

/** Logger estruturado (JSON em uma linha). Use `logger.child({ simulacaoId })` para contexto. */
export const logger = pino({
  level: env.logLevel,
  base: { servico: "simbionte" },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.senha",
      "*.refreshToken",
      "*.accessToken",
    ],
    censor: "[redigido]",
  },
});
