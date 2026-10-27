import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "../../db/prisma.ts";
import { Errors } from "../../utils/errors.ts";
import {
  consumeRefreshToken,
  issueRefreshToken,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  signAccessToken,
} from "./tokens.ts";
import type { LoginInput, RegisterInput } from "./auth.validators.ts";

const BCRYPT_COST = 12;

/**
 * Hash de uma senha aleatória, gerado uma vez por processo. Comparar contra ele quando o
 * e-mail não existe deixa o tempo de resposta igual ao de senha errada, sem revelar
 * quais e-mails têm conta.
 */
const hashFalso = bcrypt.hash(crypto.randomBytes(32).toString("hex"), BCRYPT_COST);

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

/** O `409` para e-mail repetido é intencional (o cadastro precisa avisar o usuário); ver README. */
export async function registerUsuario(input: RegisterInput): Promise<PublicUsuario> {
  const existente = await prisma.usuario.findUnique({ where: { email: input.email } });
  if (existente) throw Errors.emailInUse();

  const senhaHash = await bcrypt.hash(input.senha, BCRYPT_COST);
  const usuario = await prisma.usuario.create({
    data: { nome: input.nome, email: input.email, senhaHash },
  });

  return toPublicUsuario(usuario);
}

export async function loginUsuario(
  input: LoginInput,
): Promise<{ usuario: PublicUsuario } & AuthTokens> {
  const usuario = await prisma.usuario.findUnique({ where: { email: input.email } });
  if (!usuario) {
    await bcrypt.compare(input.senha, await hashFalso);
    throw Errors.invalidCredentials();
  }

  const senhaValida = await bcrypt.compare(input.senha, usuario.senhaHash);
  if (!senhaValida) throw Errors.invalidCredentials();

  const accessToken = signAccessToken(usuario.id);
  const refreshToken = await issueRefreshToken(usuario.id);

  return { usuario: toPublicUsuario(usuario), accessToken, refreshToken };
}

export async function refreshSession(refreshToken: string): Promise<AuthTokens> {
  const sessao = await consumeRefreshToken(refreshToken);
  if (!sessao) throw Errors.invalidRefreshToken();

  const accessToken = signAccessToken(sessao.usuarioId);
  const newRefreshToken = await issueRefreshToken(sessao.usuarioId, sessao.familia);

  return { accessToken, refreshToken: newRefreshToken };
}

export async function logoutUsuario(refreshToken: string): Promise<void> {
  await revokeRefreshToken(refreshToken);
}

/** Encerra todas as sessões do usuário. Access tokens já emitidos valem até expirar. */
export async function logoutTodasSessoes(usuarioId: number): Promise<number> {
  return revokeAllRefreshTokens(usuarioId);
}

export async function getUsuarioById(id: number): Promise<PublicUsuario | null> {
  const usuario = await prisma.usuario.findUnique({ where: { id } });
  return usuario ? toPublicUsuario(usuario) : null;
}
