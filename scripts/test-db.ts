/**
 * Prepara o banco de testes ("<banco>_test") aplicando as migrations. Roda antes de `npm test`.
 * O banco de desenvolvimento nunca é tocado.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { urlBancoTeste } from "../src/config/ambienteTeste.ts";

const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!base) {
  console.error("DATABASE_URL não definida: rode `npm run setup` ou exporte TEST_DATABASE_URL.");
  process.exit(1);
}
const url = process.env.TEST_DATABASE_URL ?? urlBancoTeste(base);

const resultado = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(resultado.status ?? 1);
