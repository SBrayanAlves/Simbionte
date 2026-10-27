import { prisma } from "../../db/prisma.ts";

// `created_at` é TIMESTAMP sem fuso gravado em UTC pelo Prisma; a comparação usa UTC explicitamente.
const LOTE = 5_000;

/**
 * Apaga, em lotes, os logs de PERCEPCAO com mais de `dias` dias. Os logs de DECISAO ficam:
 * são a base das métricas e da auditoria do Subgrupo D. Devolve o total apagado.
 */
export async function apagarLogsPercepcaoAntigos(dias: number): Promise<number> {
  if (dias <= 0) return 0;
  let total = 0;
  while (true) {
    const apagados = await prisma.$executeRaw`
      DELETE FROM logs
      WHERE id IN (
        SELECT id FROM logs
        WHERE fase = 'PERCEPCAO' AND created_at < (now() AT TIME ZONE 'UTC') - make_interval(days => ${dias}::int)
        LIMIT ${LOTE}
      )`;
    total += apagados;
    if (apagados < LOTE) return total;
  }
}
