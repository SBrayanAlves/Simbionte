import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { redis } from "../../redis/client.ts";
import { env } from "../../config/env.ts";

export interface AccessTokenPayload {
  sub: number;
}

export function signAccessToken(usuarioId: number): string {
  return jwt.sign({ sub: String(usuarioId) }, env.jwtAccessSecret, {
    expiresIn: env.jwtAccessTtlMinutes * 60,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.jwtAccessSecret);
  const sub = typeof decoded === "string" ? undefined : decoded.sub;
  const usuarioId = sub ? Number(sub) : NaN;
  if (Number.isNaN(usuarioId)) {
    throw new Error("Payload do token inválido");
  }
  return { sub: usuarioId };
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function refreshKey(hashedToken: string): string {
  return `refresh:${hashedToken}`;
}

function refreshTtlSeconds(): number {
  return env.jwtRefreshTtlDays * 24 * 60 * 60;
}

export async function issueRefreshToken(usuarioId: number): Promise<string> {
  const token = crypto.randomBytes(64).toString("hex");
  await redis.set(refreshKey(hashToken(token)), String(usuarioId), "EX", refreshTtlSeconds());
  return token;
}

/** Retorna o id do usuário e invalida o token (uso único / rotação). */
export async function consumeRefreshToken(token: string): Promise<number | null> {
  const key = refreshKey(hashToken(token));
  const usuarioId = await redis.get(key);
  if (!usuarioId) return null;
  await redis.del(key);
  return Number(usuarioId);
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await redis.del(refreshKey(hashToken(token)));
}
