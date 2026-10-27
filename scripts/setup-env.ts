/**
 * Cria o .env a partir do .env.example, trocando cada placeholder "troque-me-*" e o
 * JWT_ACCESS_SECRET vazio por valores aleatórios. Não sobrescreve um .env existente.
 *
 *   npm run setup
 */
import crypto from "node:crypto";
import fs from "node:fs";

const destino = ".env";
if (fs.existsSync(destino)) {
  console.log(".env já existe; nada foi alterado. Apague-o para gerar um novo.");
  process.exit(0);
}

const aleatorio = () => crypto.randomBytes(24).toString("hex");
const segredos = new Map<string, string>();

const conteudo = fs
  .readFileSync(".env.example", "utf8")
  // O mesmo placeholder recebe o mesmo valor em todas as linhas (ex.: senha e URL do Postgres).
  .replace(/troque-me-[a-z0-9-]+/g, (placeholder) => {
    if (!segredos.has(placeholder)) segredos.set(placeholder, aleatorio());
    return segredos.get(placeholder)!;
  })
  .replace(/^JWT_ACCESS_SECRET=\s*$/m, `JWT_ACCESS_SECRET=${crypto.randomBytes(32).toString("hex")}`);

fs.writeFileSync(destino, conteudo, { encoding: "utf8", mode: 0o600 });
console.log(`.env criado com ${segredos.size} senha(s) e um JWT_ACCESS_SECRET aleatórios.`);
