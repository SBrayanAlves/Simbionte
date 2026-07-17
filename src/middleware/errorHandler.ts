import type { ErrorRequestHandler, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/errors.ts";

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    error: { code: "not_found", message: `Rota ${req.method} ${req.path} não encontrada` },
  });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "validation_error",
        message: "Dados de entrada inválidos",
        details: err.flatten().fieldErrors,
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }

  console.error(err);
  res.status(500).json({ error: { code: "internal_error", message: "Erro interno do servidor" } });
};
