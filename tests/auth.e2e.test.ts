import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import request from "supertest";
import { app } from "../src/app.ts";
import { prisma } from "../src/db/prisma.ts";
import { redis } from "../src/redis/client.ts";

function randomEmail(): string {
  return `teste-${crypto.randomUUID()}@example.com`;
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

after(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});
