import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import request from "supertest";
import { app } from "../src/app.ts";
import { prisma } from "../src/db/prisma.ts";
import { redis } from "../src/redis/client.ts";
import jwt from "jsonwebtoken";
import { env } from "../src/config/env.ts";

const emailsCriados: string[] = [];

function randomEmail(): string {
  const email = `teste-${crypto.randomUUID()}@example.com`;
  emailsCriados.push(email);
  return email;
}

async function sessao() {
  const email = randomEmail();
  const senha = "senha1234";
  const reg = await request(app).post("/auth/register").send({ nome: "Usuário Teste", email, senha });
  assert.equal(reg.status, 201);
  const login = await request(app).post("/auth/login").send({ email, senha });
  assert.equal(login.status, 200);
  return { email, senha, accessToken: login.body.accessToken as string, refreshToken: login.body.refreshToken as string };
}

test("fluxo completo: register -> login -> /me -> refresh -> logout", async () => {
  const email = randomEmail();
  const senha = "senha1234";

  const registerRes = await request(app)
    .post("/auth/register")
    .send({ nome: "Usuário Teste", email, senha });
  assert.equal(registerRes.status, 201);
  assert.equal(registerRes.body.usuario.email, email);
  assert.equal(registerRes.body.usuario.senha, undefined);

  const duplicateRes = await request(app)
    .post("/auth/register")
    .send({ nome: "Usuário Teste", email, senha });
  assert.equal(duplicateRes.status, 409);
  assert.equal(duplicateRes.body.error.code, "email_in_use");

  const wrongLoginRes = await request(app)
    .post("/auth/login")
    .send({ email, senha: "senhaErrada" });
  assert.equal(wrongLoginRes.status, 401);

  const loginRes = await request(app).post("/auth/login").send({ email, senha });
  assert.equal(loginRes.status, 200);
  const { accessToken, refreshToken } = loginRes.body;
  assert.ok(accessToken);
  assert.ok(refreshToken);

  const noTokenRes = await request(app).get("/me");
  assert.equal(noTokenRes.status, 401);

  const meRes = await request(app).get("/me").set("Authorization", `Bearer ${accessToken}`);
  assert.equal(meRes.status, 200);
  assert.equal(meRes.body.usuario.email, email);

  const refreshRes = await request(app).post("/auth/refresh").send({ refreshToken });
  assert.equal(refreshRes.status, 200);
  assert.ok(refreshRes.body.accessToken);
  assert.notEqual(refreshRes.body.refreshToken, refreshToken);

  const reuseRes = await request(app).post("/auth/refresh").send({ refreshToken });
  assert.equal(reuseRes.status, 401);

  const logoutRes = await request(app)
    .post("/auth/logout")
    .send({ refreshToken: refreshRes.body.refreshToken });
  assert.equal(logoutRes.status, 204);

  const refreshAfterLogoutRes = await request(app)
    .post("/auth/refresh")
    .send({ refreshToken: refreshRes.body.refreshToken });
  assert.equal(refreshAfterLogoutRes.status, 401);
});

test("register com payload inválido retorna 400", async () => {
  const res = await request(app)
    .post("/auth/register")
    .send({ nome: "A", email: "invalido", senha: "123" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "validation_error");
});

test("logout com refresh token desconhecido é idempotente (204)", async () => {
  const res = await request(app).post("/auth/logout").send({ refreshToken: "token-inexistente" });
  assert.equal(res.status, 204);
});

test("reapresentar um refresh token já usado revoga a sessão inteira (família)", async () => {
  const { refreshToken: original } = await sessao();

  const rotacao = await request(app).post("/auth/refresh").send({ refreshToken: original });
  assert.equal(rotacao.status, 200);
  const legitimo = rotacao.body.refreshToken;

  // Alguém reaproveita o token antigo (roubado): recebe 401 e derruba a família.
  const reuso = await request(app).post("/auth/refresh").send({ refreshToken: original });
  assert.equal(reuso.status, 401);

  const depois = await request(app).post("/auth/refresh").send({ refreshToken: legitimo });
  assert.equal(depois.status, 401, "o token mais novo da mesma família também deve morrer");
});

test("logout-all encerra todas as sessões do usuário", async () => {
  const primeira = await sessao();
  const segunda = await request(app).post("/auth/login").send({ email: primeira.email, senha: primeira.senha });
  assert.equal(segunda.status, 200);

  const semToken = await request(app).post("/auth/logout-all");
  assert.equal(semToken.status, 401);

  const res = await request(app)
    .post("/auth/logout-all")
    .set("Authorization", `Bearer ${primeira.accessToken}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.sessoesEncerradas, 2);

  for (const refreshToken of [primeira.refreshToken, segunda.body.refreshToken]) {
    const r = await request(app).post("/auth/refresh").send({ refreshToken });
    assert.equal(r.status, 401);
  }
});

test("access token com algoritmo, emissor ou audiência diferentes é recusado", async () => {
  const { accessToken } = await sessao();
  const { sub } = jwt.decode(accessToken) as { sub: string };

  const invalidos = [
    jwt.sign({}, env.jwtAccessSecret, { algorithm: "HS512", subject: sub, issuer: env.jwtIssuer, audience: env.jwtAudience }),
    jwt.sign({}, env.jwtAccessSecret, { subject: sub, issuer: "outro", audience: env.jwtAudience }),
    jwt.sign({}, env.jwtAccessSecret, { subject: sub, issuer: env.jwtIssuer, audience: "outra" }),
    jwt.sign({ sub }, env.jwtAccessSecret),
  ];
  for (const token of invalidos) {
    const res = await request(app).get("/me").set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 401);
  }
});

test("/health público não revela os serviços; /health/detalhes exige autenticação", async () => {
  const publico = await request(app).get("/health");
  assert.equal(publico.body.services, undefined);

  const semToken = await request(app).get("/health/detalhes");
  assert.equal(semToken.status, 401);

  const { accessToken } = await sessao();
  const detalhes = await request(app).get("/health/detalhes").set("Authorization", `Bearer ${accessToken}`);
  assert.equal(detalhes.body.services.postgres, "ok");
  assert.equal(detalhes.body.services.redis, "ok");
});

after(async () => {
  await prisma.usuario.deleteMany({ where: { email: { in: emailsCriados } } });
  await prisma.$disconnect();
  redis.disconnect();
});
