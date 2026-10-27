import { Pool, type PoolClient } from "pg";
import { env } from "../config/env.ts";
import { logger } from "../utils/logger.ts";

/**
 * Travas por simulação entre processos (API e workers), com `pg_try_advisory_lock`.
 *
 * A trava é de sessão do Postgres, então precisa de uma conexão dedicada enquanto o ciclo
 * roda: por isso este pool é separado do Prisma. Se o processo morrer, a conexão cai e o
 * Postgres libera a trava sozinho. `allowExitOnIdle` deixa o processo terminar quando não
 * há trava em uso (testes não ficam pendurados).
 */
const NAMESPACE_SIMULACAO = 51_710;

let pool: Pool | null = null;

function obterPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: env.databaseUrl, max: 20, allowExitOnIdle: true });
    pool.on("error", (err) => logger.error({ err }, "erro numa conexão ociosa do pool de travas"));
  }
  return pool;
}

export interface Trava {
  liberar(): Promise<void>;
}

/** Tenta travar a simulação sem esperar. Devolve `null` se outro processo já a tem. */
export async function tentarTravarSimulacao(simulacaoId: number): Promise<Trava | null> {
  const cliente: PoolClient = await obterPool().connect();
  try {
    const { rows } = await cliente.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS ok",
      [NAMESPACE_SIMULACAO, simulacaoId],
    );
    if (!rows[0]?.ok) {
      cliente.release();
      return null;
    }
  } catch (err) {
    cliente.release(true);
    throw err;
  }

  let liberada = false;
  return {
    async liberar() {
      if (liberada) return;
      liberada = true;
      try {
        await cliente.query("SELECT pg_advisory_unlock($1, $2)", [NAMESPACE_SIMULACAO, simulacaoId]);
        cliente.release();
      } catch (err) {
        // Descartar a conexão também libera a trava no Postgres.
        cliente.release(true);
        logger.warn({ err, simulacaoId }, "falha ao liberar trava; conexão descartada");
      }
    },
  };
}

export async function fecharTravas(): Promise<void> {
  if (!pool) return;
  const atual = pool;
  pool = null;
  await atual.end();
}
