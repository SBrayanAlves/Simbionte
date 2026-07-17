import type { Request, Response } from "express";
import { loginSchema, logoutSchema, refreshSchema, registerSchema } from "./auth.validators.ts";
import * as authService from "./auth.service.ts";
import { Errors } from "../../utils/errors.ts";

export async function register(req: Request, res: Response) {
  const input = registerSchema.parse(req.body);
  const usuario = await authService.registerUsuario(input);
  res.status(201).json({ usuario });
}

export async function login(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);
  const { usuario, accessToken, refreshToken } = await authService.loginUsuario(input);
  res.status(200).json({ usuario, accessToken, refreshToken });
}

export async function refresh(req: Request, res: Response) {
  const { refreshToken } = refreshSchema.parse(req.body);
  const tokens = await authService.refreshSession(refreshToken);
  res.status(200).json(tokens);
}

export async function logout(req: Request, res: Response) {
  const { refreshToken } = logoutSchema.parse(req.body);
  await authService.logoutUsuario(refreshToken);
  res.status(204).send();
}

export async function me(req: Request, res: Response) {
  const usuarioId = req.usuarioId;
  if (!usuarioId) throw Errors.unauthorized();

  const usuario = await authService.getUsuarioById(usuarioId);
  if (!usuario) throw Errors.notFound("Usuário não encontrado");

  res.status(200).json({ usuario });
}
