import bcrypt from "bcrypt";
import { prisma } from "../../db/prisma.ts";
import { Errors } from "../../utils/errors.ts";
import {
  consumeRefreshToken,
  issueRefreshToken,
  revokeRefreshToken,
  signAccessToken,
} from "./tokens.ts";
import type { LoginInput, RegisterInput } from "./auth.validators.ts";

const BCRYPT_COST = 12;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface PublicUsuario {
  id: number;
  nome: string;
  email: string;
}

function toPublicUsuario(usuario: { id: number; nome: string; email: string }): PublicUsuario {
  return { id: usuario.id, nome: usuario.nome, email: usuario.email };
}

export async function registerUsuario(input: RegisterInput): Promise<PublicUsuario> {
  const existente = await prisma.usuario.findUnique({ where: { email: input.email } });
  if (existente) throw Errors.emailInUse();

  const senhaHash = await bcrypt.hash(input.senha, BCRYPT_COST);
  const usuario = await prisma.usuario.create({
    data: { nome: input.nome, email: input.email, senha: senhaHash },
  });

  return toPublicUsuario(usuario);
}

export async function loginUsuario(
  input: LoginInput,
): Promise<{ usuario: PublicUsuario } & AuthTokens> {
  const usuario = await prisma.usuario.findUnique({ where: { email: input.email } });
  if (!usuario) throw Errors.invalidCredentials();

  const senhaValida = await bcrypt.compare(input.senha, usuario.senha);
  if (!senhaValida) throw Errors.invalidCredentials();

  const accessToken = signAccessToken(usuario.id);
  const refreshToken = await issueRefreshToken(usuario.id);

  return { usuario: toPublicUsuario(usuario), accessToken, refreshToken };
}

export async function refreshSession(refreshToken: string): Promise<AuthTokens> {
  const usuarioId = await consumeRefreshToken(refreshToken);
  if (!usuarioId) throw Errors.invalidRefreshToken();

  const accessToken = signAccessToken(usuarioId);
  const newRefreshToken = await issueRefreshToken(usuarioId);

  return { accessToken, refreshToken: newRefreshToken };
}

export async function logoutUsuario(refreshToken: string): Promise<void> {
  await revokeRefreshToken(refreshToken);
}

export async function getUsuarioById(id: number): Promise<PublicUsuario | null> {
  const usuario = await prisma.usuario.findUnique({ where: { id } });
  return usuario ? toPublicUsuario(usuario) : null;
}
