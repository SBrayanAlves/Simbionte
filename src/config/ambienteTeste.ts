/**
 * URLs usadas pelos testes. Os testes nunca tocam no banco nem no Redis de desenvolvimento:
 * o Postgres vira "<banco>_test" e o Redis passa para o banco lógico 1.
 */
export function urlBancoTeste(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const banco = url.pathname.replace(/^\//, "") || "simbionte";
  if (!banco.endsWith("_test")) url.pathname = `/${banco}_test`;
  return url.toString();
}

export function urlRedisTeste(redisUrl: string): string {
  const url = new URL(redisUrl);
  url.pathname = "/1";
  return url.toString();
}
