import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../modules/auth/tokens.ts";
import { Errors } from "../utils/errors.ts";

declare global {
  namespace Express {
    interface Request {
      usuarioId?: number;
    }
  }
}

export function authGuard(req: Request, _res: Response, next: NextFunction) {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    next(Errors.unauthorized("Token de acesso ausente"));
    return;
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyAccessToken(token);
    req.usuarioId = payload.sub;
    next();
  } catch {
    next(Errors.unauthorized("Token de acesso inválido ou expirado"));
  }
}
