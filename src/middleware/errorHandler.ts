import type { ErrorRequestHandler, Request, Response } from "express";
import { ZodError, z } from "zod";
import { AppError } from "../utils/errors.ts";
import { logger } from "../utils/logger.ts";

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    error: { code: "not_found", message: `Rota ${req.method} ${req.path} não encontrada` },
  });
};

/** Erros do body-parser (express.json) trazem `type` e `status`; são culpa do cliente, não 500. */
const ERROS_DO_CORPO: Record<string, { status: number; code: string; message: string }> = {
  "entity.parse.failed": { status: 400, code: "invalid_json", message: "Corpo da requisição não é um JSON válido" },
  "entity.too.large": { status: 413, code: "payload_too_large", message: "Corpo da requisição grande demais" },
  "encoding.unsupported": { status: 415, code: "unsupported_encoding", message: "Codificação do corpo não suportada" },
  "charset.unsupported": { status: 415, code: "unsupported_charset", message: "Charset do corpo não suportado" },
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "validation_error",
        message: "Dados de entrada inválidos",
        details: z.flattenError(err).fieldErrors,
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }

  const erroDoCorpo = typeof err?.type === "string" ? ERROS_DO_CORPO[err.type] : undefined;
  if (erroDoCorpo) {
    res.status(erroDoCorpo.status).json({ error: { code: erroDoCorpo.code, message: erroDoCorpo.message } });
    return;
  }

  (req.log ?? logger).error({ err }, "erro não tratado na requisição");
  res.status(500).json({ error: { code: "internal_error", message: "Erro interno do servidor" } });
};
