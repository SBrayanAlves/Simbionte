import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { redis } from "../../redis/client.ts";
import type { Result } from "ioredis";
import { env } from "../../config/env.ts";

export interface AccessTokenPayload {
  sub: number;
}

const ALGORITMO = "HS256";

export function signAccessToken(usuarioId: number): string {
  return jwt.sign({}, env.jwtAccessSecret, {
    algorithm: ALGORITMO,
    subject: String(usuarioId),
    issuer: env.jwtIssuer,
    audience: env.jwtAudience,
    expiresIn: env.jwtAccessTtlMinutes * 60,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.jwtAccessSecret, {
    algorithms: [ALGORITMO],
    issuer: env.jwtIssuer,
    audience: env.jwtAudience,
  });
  const sub = typeof decoded === "string" ? undefined : decoded.sub;
  const usuarioId = sub ? Number(sub) : NaN;
  if (!Number.isSafeInteger(usuarioId) || usuarioId <= 0) {
    throw new Error("Payload do token inválido");
  }
  return { sub: usuarioId };
}

/*
 * Modelo de sessão no Redis
 *
 *   refresh:<hash>       -> {"u":<usuarioId>,"f":<familia>}  token vivo (TTL do refresh)
 *   refresh_usado:<hash> -> {"u":...,"f":...}                token já consumido (detecção de reuso)
 *   familia:<f>          -> <hash do token vivo da família>
 *   sessoes:<usuarioId>  -> SET de famílias ativas do usuário (logout global)
 *
 * Uma "família" nasce no login e atravessa todas as rotações. Se um token já consumido volta
 * a ser apresentado, alguém tem uma cópia dele: a família inteira é revogada.
 */

interface Sessao {
  u: number;
  f: string;
}

type ResultadoConsumo =
  | { tipo: "ok"; usuarioId: number; familia: string }
  | { tipo: "reuso"; usuarioId: number; familia: string }
  | { tipo: "invalido" };

// GETDEL + marca de consumido numa única operação atômica: sob concorrência só um vence.
const LUA_CONSUMIR = `
local v = redis.call('GETDEL', KEYS[1])
if v then
  redis.call('SET', KEYS[2], v, 'EX', ARGV[1])
  return {'ok', v}
end
local usado = redis.call('GET', KEYS[2])
if usado then return {'reuso', usado} end
return false
`;

// Revoga a família só se o token vivo dela ainda for o mesmo lido (evita apagar uma rotação nova).
const LUA_REVOGAR_FAMILIA = `
local h = redis.call('GET', KEYS[1])
if h then redis.call('DEL', ARGV[2] .. h) end
redis.call('DEL', KEYS[1])
redis.call('SREM', KEYS[2], ARGV[1])
return 1
`;

redis.defineCommand("consumirRefresh", { numberOfKeys: 2, lua: LUA_CONSUMIR });
redis.defineCommand("revogarFamilia", { numberOfKeys: 2, lua: LUA_REVOGAR_FAMILIA });

declare module "ioredis" {
  interface RedisCommander<Context> {
    consumirRefresh(chave: string, chaveUsado: string, ttl: number): Result<[string, string] | null, Context>;
    revogarFamilia(chaveFamilia: string, chaveSessoes: string, familia: string, prefixo: string): Result<number, Context>;
  }
}

const PREFIXO_REFRESH = "refresh:";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const refreshKey = (hash: string) => `${PREFIXO_REFRESH}${hash}`;
const usadoKey = (hash: string) => `refresh_usado:${hash}`;
const familiaKey = (familia: string) => `familia:${familia}`;
const sessoesKey = (usuarioId: number) => `sessoes:${usuarioId}`;

function refreshTtlSeconds(): number {
  return env.jwtRefreshTtlDays * 24 * 60 * 60;
}

function lerSessao(valor: string): Sessao | null {
  try {
    const sessao = JSON.parse(valor) as Partial<Sessao>;
    if (typeof sessao.u === "number" && typeof sessao.f === "string") return { u: sessao.u, f: sessao.f };
  } catch {
    // valor legado ou corrompido
  }
  return null;
}

/** Emite um refresh token. Sem `familia`, abre uma sessão nova (login). */
export async function issueRefreshToken(
  usuarioId: number,
  familia: string = crypto.randomUUID(),
): Promise<string> {
  const token = crypto.randomBytes(64).toString("hex");
  const hash = hashToken(token);
  const ttl = refreshTtlSeconds();
  const sessao: Sessao = { u: usuarioId, f: familia };
  await redis
    .multi()
    .set(refreshKey(hash), JSON.stringify(sessao), "EX", ttl)
    .set(familiaKey(familia), hash, "EX", ttl)
    .sadd(sessoesKey(usuarioId), familia)
    .expire(sessoesKey(usuarioId), ttl)
    .exec();
  return token;
}

async function revogarFamilia(usuarioId: number, familia: string): Promise<void> {
  await redis.revogarFamilia(familiaKey(familia), sessoesKey(usuarioId), familia, PREFIXO_REFRESH);
}

/**
 * Consome o token (uso único). Devolve o usuário e a família para a rotação, ou `null`.
 * Reapresentar um token já consumido revoga a família inteira.
 */
export async function consumeRefreshToken(token: string): Promise<{ usuarioId: number; familia: string } | null> {
  const resultado = await consumir(token);
  if (resultado.tipo === "ok") return { usuarioId: resultado.usuarioId, familia: resultado.familia };
  if (resultado.tipo === "reuso") await revogarFamilia(resultado.usuarioId, resultado.familia);
  return null;
}

async function consumir(token: string): Promise<ResultadoConsumo> {
  const hash = hashToken(token);
  const resposta = await redis.consumirRefresh(refreshKey(hash), usadoKey(hash), refreshTtlSeconds());
  if (!resposta) return { tipo: "invalido" };
  const [tipo, valor] = resposta;
  const sessao = lerSessao(valor);
  if (!sessao) return { tipo: "invalido" };
  return { tipo: tipo === "ok" ? "ok" : "reuso", usuarioId: sessao.u, familia: sessao.f };
}

/** Logout de uma sessão: invalida o token e a família dele. Idempotente. */
export async function revokeRefreshToken(token: string): Promise<void> {
  const resultado = await consumir(token);
  if (resultado.tipo !== "invalido") await revogarFamilia(resultado.usuarioId, resultado.familia);
}

/** Logout global: revoga todas as sessões (famílias) do usuário. */
export async function revokeAllRefreshTokens(usuarioId: number): Promise<number> {
  const familias = await redis.smembers(sessoesKey(usuarioId));
  for (const familia of familias) await revogarFamilia(usuarioId, familia);
  await redis.del(sessoesKey(usuarioId));
  return familias.length;
}
