-- CreateEnum
CREATE TYPE "situacao_simulacao" AS ENUM ('CRIADA', 'EXECUTANDO', 'PAUSADA');

-- CreateEnum
CREATE TYPE "situacao_ciclo" AS ENUM ('EM_ANDAMENTO', 'CONCLUIDO', 'FALHOU');

-- CreateEnum
CREATE TYPE "fase_ciclo" AS ENUM ('PERCEPCAO', 'DECISAO');

-- CreateTable
CREATE TABLE "simulacao" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "intervalo_segundos" INTEGER NOT NULL,
    "situacao" "situacao_simulacao" NOT NULL DEFAULT 'CRIADA',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "simulacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "simulacao_id" INTEGER NOT NULL,
    "nome_agente" TEXT NOT NULL,
    "provedor_llm" TEXT NOT NULL,
    "chave_api_criptografada" TEXT,
    "prompt_alma" TEXT NOT NULL,
    "saldo_md" INTEGER NOT NULL DEFAULT 1000,
    "trust_score" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ciclo" (
    "id" SERIAL NOT NULL,
    "simulacao_id" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fim" TIMESTAMP(3),
    "situacao" "situacao_ciclo" NOT NULL DEFAULT 'EM_ANDAMENTO',
    "total_agentes" INTEGER NOT NULL DEFAULT 0,
    "decisoes_validas" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,

    CONSTRAINT "ciclo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logs" (
    "id" SERIAL NOT NULL,
    "ciclo_id" INTEGER NOT NULL,
    "agent_id" INTEGER,
    "fase" "fase_ciclo" NOT NULL,
    "acao" TEXT,
    "valido" BOOLEAN NOT NULL DEFAULT true,
    "detalhes" JSONB NOT NULL,
    "latencia_ms" INTEGER,
    "tokens_entrada" INTEGER,
    "tokens_saida" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "simulacao_usuario_id_idx" ON "simulacao"("usuario_id");

-- CreateIndex
CREATE INDEX "agents_simulacao_id_idx" ON "agents"("simulacao_id");

-- CreateIndex
CREATE INDEX "agents_usuario_id_idx" ON "agents"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "ciclo_simulacao_id_numero_key" ON "ciclo"("simulacao_id", "numero");

-- CreateIndex
CREATE INDEX "logs_ciclo_id_fase_idx" ON "logs"("ciclo_id", "fase");

-- CreateIndex
CREATE INDEX "logs_agent_id_created_at_idx" ON "logs"("agent_id", "created_at");

-- AddForeignKey
ALTER TABLE "simulacao" ADD CONSTRAINT "simulacao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_simulacao_id_fkey" FOREIGN KEY ("simulacao_id") REFERENCES "simulacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ciclo" ADD CONSTRAINT "ciclo_simulacao_id_fkey" FOREIGN KEY ("simulacao_id") REFERENCES "simulacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logs" ADD CONSTRAINT "logs_ciclo_id_fkey" FOREIGN KEY ("ciclo_id") REFERENCES "ciclo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logs" ADD CONSTRAINT "logs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
