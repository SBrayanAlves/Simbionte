-- Auditoria P0-P4

-- P4-02: a coluna guarda o hash bcrypt, não a senha.
ALTER TABLE "usuario" RENAME COLUMN "senha" TO "senha_hash";

-- P2-05: a parte comum do relatório de percepção é gravada uma vez por ciclo.
ALTER TABLE "ciclo" ADD COLUMN "relatorio_comum" JSONB;

-- P3-05: invariantes que o banco passa a garantir. O Prisma não declara CHECK no schema,
-- mas preserva estas constraints (não as remove em migrations futuras).
ALTER TABLE "agents"
  ADD CONSTRAINT "agents_trust_score_check" CHECK ("trust_score" >= 0 AND "trust_score" <= 1),
  ADD CONSTRAINT "agents_saldo_md_check" CHECK ("saldo_md" >= 0);

ALTER TABLE "simulacao"
  ADD CONSTRAINT "simulacao_intervalo_segundos_check" CHECK ("intervalo_segundos" >= 1);

ALTER TABLE "ciclo"
  ADD CONSTRAINT "ciclo_numero_check" CHECK ("numero" >= 1),
  ADD CONSTRAINT "ciclo_total_agentes_check" CHECK ("total_agentes" >= 0),
  ADD CONSTRAINT "ciclo_decisoes_validas_check" CHECK ("decisoes_validas" >= 0 AND "decisoes_validas" <= "total_agentes");

-- P2-05: a retenção apaga logs de percepção antigos por data.
CREATE INDEX "logs_fase_created_at_idx" ON "logs"("fase", "created_at");
