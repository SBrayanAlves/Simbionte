import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import request from "supertest";
import { app } from "../src/app.ts";
import { prisma } from "../src/db/prisma.ts";
import { redis } from "../src/redis/client.ts";
import { Orquestrador, orquestrador } from "../src/modules/ciclos/orquestrador.ts";
import { StubLlmGateway } from "../src/modules/ciclos/gateway.ts";
import { extrairJson } from "../src/modules/ciclos/decisao.ts";
import { respostaAgenteSchema } from "../src/modules/ciclos/tipos.ts";

const usuariosCriados: number[] = [];

async function novoUsuario(): Promise<{ token: string; id: number }> {
  const email = `ciclos-${crypto.randomUUID()}@example.com`;
  const senha = "senha1234";
  const reg = await request(app).post("/auth/register").send({ nome: "Teste Ciclos", email, senha });
  assert.equal(reg.status, 201);
  usuariosCriados.push(reg.body.usuario.id);
  const login = await request(app).post("/auth/login").send({ email, senha });
  assert.equal(login.status, 200);
  return { token: login.body.accessToken, id: reg.body.usuario.id };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function criarSimulacao(token: string, intervaloSegundos = 300): Promise<number> {
  const res = await request(app)
    .post("/simulacoes")
    .set(auth(token))
    .send({ nome: "Simulação de teste", intervaloSegundos });
  assert.equal(res.status, 201);
  return res.body.simulacao.id;
}

async function criarAgente(token: string, simulacaoId: number, nome: string, promptAlma = "Maximizar influência com informação confiável.") {
  const res = await request(app)
    .post(`/simulacoes/${simulacaoId}/agentes`)
    .set(auth(token))
    .send({ nomeAgente: nome, provedorLlm: "stub", promptAlma });
  assert.equal(res.status, 201);
  assert.equal(res.body.agente.chaveApiCriptografada, undefined);
  assert.equal(res.body.agente.promptAlma, undefined);
  return res.body.agente.id as number;
}

test("protocolo de resposta do agente: validação do schema", () => {
  const ok = respostaAgenteSchema.safeParse({
    action: "PUBLICAR",
    parameters: { target: "topico-1", value: 10, tipo: "ARTIGO" },
    rationale: "Tópico em alta.",
  });
  assert.equal(ok.success, true);

  const ocioso = respostaAgenteSchema.safeParse({ action: "OCIOSO", rationale: "Poupar saldo." });
  assert.equal(ocioso.success, true);

  const semAlvo = respostaAgenteSchema.safeParse({ action: "COMENTAR", rationale: "x" });
  assert.equal(semAlvo.success, false);

  const acaoInvalida = respostaAgenteSchema.safeParse({ action: "TRANSFERIR", rationale: "x" });
  assert.equal(acaoInvalida.success, false);

  const semRationale = respostaAgenteSchema.safeParse({ action: "OCIOSO" });
  assert.equal(semRationale.success, false);

  const cercado = extrairJson('Claro!\n```json\n{"action":"OCIOSO","rationale":"ok"}\n```');
  assert.deepEqual(cercado, { action: "OCIOSO", rationale: "ok" });
  assert.throws(() => extrairJson("sem json aqui"));
});

test("rotas de simulação exigem autenticação e isolam usuários", async () => {
  const semToken = await request(app).post("/simulacoes").send({ nome: "X" });
  assert.equal(semToken.status, 401);

  const dono = await novoUsuario();
  const outro = await novoUsuario();
  const simulacaoId = await criarSimulacao(dono.token);

  const alheia = await request(app).get(`/simulacoes/${simulacaoId}`).set(auth(outro.token));
  assert.equal(alheia.status, 404);
  const iniciarAlheia = await request(app)
    .post(`/simulacoes/${simulacaoId}/ciclos/iniciar`)
    .set(auth(outro.token));
  assert.equal(iniciarAlheia.status, 404);

  const invalida = await request(app)
    .post("/simulacoes")
    .set(auth(dono.token))
    .send({ nome: "A", intervaloSegundos: 0 });
  assert.equal(invalida.status, 400);
  assert.equal(invalida.body.error.code, "validation_error");
});

test("fluxo completo: percepção -> decisão -> registro, ciclo a ciclo", async () => {
  const { token } = await novoUsuario();
  const simulacaoId = await criarSimulacao(token);

  const semAgentes = await request(app)
    .post(`/simulacoes/${simulacaoId}/ciclos/executar`)
    .set(auth(token));
  assert.equal(semAgentes.status, 409);
  assert.equal(semAgentes.body.error.code, "sem_agentes");

  const ids = [
    await criarAgente(token, simulacaoId, "Verificador"),
    await criarAgente(token, simulacaoId, "Clickbait Master"),
    await criarAgente(token, simulacaoId, "Analista"),
  ];

  const c1 = await request(app).post(`/simulacoes/${simulacaoId}/ciclos/executar`).set(auth(token));
  assert.equal(c1.status, 201);
  assert.equal(c1.body.ciclo.numero, 1);
  assert.equal(c1.body.ciclo.situacao, "CONCLUIDO");
  assert.equal(c1.body.ciclo.totalAgentes, 3);
  assert.equal(c1.body.ciclo.decisoesValidas, 3);
  assert.ok(c1.body.ciclo.fim);
  assert.ok(c1.body.ciclo.duracaoMs >= 0);

  const c2 = await request(app).post(`/simulacoes/${simulacaoId}/ciclos/executar`).set(auth(token));
  assert.equal(c2.status, 201);
  assert.equal(c2.body.ciclo.numero, 2);

  const detalhe = await request(app).get(`/simulacoes/${simulacaoId}/ciclos/2`).set(auth(token));
  assert.equal(detalhe.status, 200);
  const logs = detalhe.body.ciclo.logs as Array<Record<string, any>>;
  const percepcao = logs.filter((l) => l.fase === "PERCEPCAO");
  const decisao = logs.filter((l) => l.fase === "DECISAO");
  assert.equal(percepcao.length, 3);
  assert.equal(decisao.length, 3);
  assert.deepEqual(percepcao.map((l) => l.agentId).sort(), [...ids].sort());

  // Relatório de estado: inventário, ranking e ações do ciclo anterior.
  const relatorio = percepcao[0]!.detalhes;
  assert.equal(relatorio.ciclo, 2);
  assert.equal(relatorio.dia, 1);
  assert.equal(relatorio.agente.saldoMd, 1000);
  assert.equal(relatorio.agente.trustScore, 0.5);
  assert.equal(relatorio.ecossistema.totalAgentes, 3);
  assert.ok(relatorio.acoesImpactantesCicloAnterior.length <= 3);
  assert.ok(relatorio.acoesImpactantesCicloAnterior.length > 0, "ciclo 1 teve ações não ociosas");

  // Decisão: resposta estruturada validada, com métricas por chamada.
  for (const log of decisao) {
    assert.equal(log.valido, true);
    assert.ok(["CRIAR_CONCEITO", "PUBLICAR", "VERIFICAR_FATOS", "COMENTAR", "OCIOSO"].includes(log.acao));
    assert.equal(log.detalhes.resposta.agent_id, String(log.agentId));
    assert.ok(log.latenciaMs >= 0);
    assert.ok(log.tokensEntrada > 0);
  }

  const lista = await request(app).get(`/simulacoes/${simulacaoId}/ciclos`).set(auth(token));
  assert.equal(lista.status, 200);
  assert.equal(lista.body.total, 2);
  assert.deepEqual(lista.body.ciclos.map((c: any) => c.numero), [2, 1]);

  const inexistente = await request(app).get(`/simulacoes/${simulacaoId}/ciclos/99`).set(auth(token));
  assert.equal(inexistente.status, 404);

  const metricas = await request(app).get(`/simulacoes/${simulacaoId}/metricas`).set(auth(token));
  assert.equal(metricas.status, 200);
  assert.equal(metricas.body.metricas.ciclos.total, 2);
  assert.equal(metricas.body.metricas.ciclos.taxaSucesso, 1);
  assert.equal(metricas.body.metricas.decisoes.total, 6);
  assert.equal(metricas.body.metricas.decisoes.taxaValidas, 1);
  assert.ok(metricas.body.metricas.decisoes.tokensEntrada > 0);

  const sim = await request(app).get(`/simulacoes/${simulacaoId}`).set(auth(token));
  assert.equal(sim.body.simulacao.totalAgentes, 3);
  assert.equal(sim.body.simulacao.ultimoCiclo.numero, 2);
});

test("falha de um agente não derruba o ciclo: fallback OCIOSO e registro do erro", async () => {
  const { token } = await novoUsuario();
  const simulacaoId = await criarSimulacao(token);
  const bom = await criarAgente(token, simulacaoId, "Agente OK");
  const invalido = await criarAgente(token, simulacaoId, "Agente JSON ruim", "Estratégia qualquer [[STUB:INVALIDO]]");
  const erro = await criarAgente(token, simulacaoId, "Agente provedor fora", "Estratégia qualquer [[STUB:ERRO]]");
  const lento = await criarAgente(token, simulacaoId, "Agente lento", "Estratégia qualquer [[STUB:LENTO]]");

  const rapido = new Orquestrador(new StubLlmGateway(), { timeoutMs: 300, tentativas: 2, concorrencia: 4 });
  const inicio = Date.now();
  const ciclo = await rapido.executarCiclo(simulacaoId);
  const total = Date.now() - inicio;

  assert.equal(ciclo.situacao, "CONCLUIDO");
  assert.equal(ciclo.totalAgentes, 4);
  assert.equal(ciclo.decisoesValidas, 1);
  assert.ok(total < 2500, `ciclo deveria terminar em ~600 ms (2 tentativas x 300 ms), levou ${total} ms`);

  const logs = await prisma.logCiclo.findMany({
    where: { cicloId: ciclo.id, fase: "DECISAO" },
  });
  const porAgente = new Map(logs.map((l) => [l.agentId, l]));

  assert.equal(porAgente.get(bom)!.valido, true);
  for (const id of [invalido, erro, lento]) {
    const log = porAgente.get(id)!;
    assert.equal(log.valido, false);
    assert.equal(log.acao, "OCIOSO");
    assert.equal((log.detalhes as any).tentativas, 2);
    assert.ok(typeof (log.detalhes as any).erro === "string" && (log.detalhes as any).erro.length > 0);
  }
  assert.match((porAgente.get(lento)!.detalhes as any).erro, /Timeout/);
  assert.match((porAgente.get(invalido)!.detalhes as any).erro, /JSON/);

  const metricas = await request(app).get(`/simulacoes/${simulacaoId}/metricas`).set(auth(token));
  assert.equal(metricas.body.metricas.decisoes.taxaValidas, 0.25);
});

test("dois ciclos da mesma simulação não se sobrepõem", async () => {
  const { token } = await novoUsuario();
  const simulacaoId = await criarSimulacao(token);
  await criarAgente(token, simulacaoId, "Agente lerdo", "Estratégia qualquer [[STUB:ATRASO=500]]");

  const [a, b] = await Promise.all([
    request(app).post(`/simulacoes/${simulacaoId}/ciclos/executar`).set(auth(token)),
    request(app).post(`/simulacoes/${simulacaoId}/ciclos/executar`).set(auth(token)),
  ]);
  const status = [a.status, b.status].sort();
  assert.deepEqual(status, [201, 409]);
  const rejeitada = a.status === 409 ? a : b;
  assert.equal(rejeitada.body.error.code, "ciclo_em_andamento");

  const total = await prisma.ciclo.count({ where: { simulacaoId } });
  assert.equal(total, 1);
});

test("serviço de início de ciclo: laço contínuo com intervalo configurável", async () => {
  const { token } = await novoUsuario();
  const simulacaoId = await criarSimulacao(token, 1);
  await criarAgente(token, simulacaoId, "Agente contínuo");

  const iniciar = await request(app)
    .post(`/simulacoes/${simulacaoId}/ciclos/iniciar`)
    .set(auth(token));
  assert.equal(iniciar.status, 202);
  assert.equal(iniciar.body.simulacao.situacao, "EXECUTANDO");

  const duplicado = await request(app)
    .post(`/simulacoes/${simulacaoId}/ciclos/iniciar`)
    .set(auth(token));
  assert.equal(duplicado.status, 409);
  assert.equal(duplicado.body.error.code, "simulacao_em_execucao");

  const limite = Date.now() + 10_000;
  let concluidos = 0;
  while (Date.now() < limite && concluidos < 3) {
    await new Promise((r) => setTimeout(r, 200));
    concluidos = await prisma.ciclo.count({ where: { simulacaoId, situacao: "CONCLUIDO" } });
  }
  assert.ok(concluidos >= 3, `esperava >= 3 ciclos em 10 s com intervalo de 1 s, houve ${concluidos}`);

  const parar = await request(app).post(`/simulacoes/${simulacaoId}/ciclos/parar`).set(auth(token));
  assert.equal(parar.status, 200);
  assert.equal(parar.body.simulacao.situacao, "PAUSADA");

  await new Promise((r) => setTimeout(r, 300)); // deixa terminar um ciclo em voo
  const antes = await prisma.ciclo.count({ where: { simulacaoId } });
  await new Promise((r) => setTimeout(r, 1600));
  const depois = await prisma.ciclo.count({ where: { simulacaoId } });
  assert.equal(depois, antes, "nenhum ciclo novo deve começar depois de parar");

  const emAndamento = await prisma.ciclo.count({ where: { simulacaoId, situacao: "EM_ANDAMENTO" } });
  assert.equal(emAndamento, 0);

  // Numeração contínua, sem buracos nem repetições.
  const numeros = (await prisma.ciclo.findMany({ where: { simulacaoId }, orderBy: { numero: "asc" } })).map(
    (c) => c.numero,
  );
  assert.deepEqual(numeros, numeros.map((_, i) => i + 1));
});

test("retomada após queda: ciclo órfão vira FALHOU e simulação EXECUTANDO reinicia", async () => {
  const { token } = await novoUsuario();
  const simulacaoId = await criarSimulacao(token, 1);
  await criarAgente(token, simulacaoId, "Agente sobrevivente");

  await prisma.simulacao.update({ where: { id: simulacaoId }, data: { situacao: "EXECUTANDO" } });
  const orfao = await prisma.ciclo.create({
    data: { simulacaoId, numero: 1, situacao: "EM_ANDAMENTO", totalAgentes: 1 },
  });

  const reiniciado = new Orquestrador(new StubLlmGateway(), { timeoutMs: 300, tentativas: 1 });
  await reiniciado.retomar();
  assert.equal(reiniciado.estaAtivo(simulacaoId), true);

  const marcado = await prisma.ciclo.findUniqueOrThrow({ where: { id: orfao.id } });
  assert.equal(marcado.situacao, "FALHOU");
  assert.match(marcado.erro ?? "", /reinício/);

  const limite = Date.now() + 5000;
  let novos = 0;
  while (Date.now() < limite && novos < 1) {
    await new Promise((r) => setTimeout(r, 100));
    novos = await prisma.ciclo.count({ where: { simulacaoId, numero: 2, situacao: "CONCLUIDO" } });
  }
  assert.equal(novos, 1, "o ciclo 2 deve ser executado depois da retomada");

  await reiniciado.encerrar();
});

after(async () => {
  await orquestrador.encerrar();
  if (usuariosCriados.length > 0) {
    await prisma.simulacao.deleteMany({ where: { usuarioId: { in: usuariosCriados } } });
    await prisma.usuario.deleteMany({ where: { id: { in: usuariosCriados } } });
  }
  await prisma.$disconnect();
  redis.disconnect();
});
