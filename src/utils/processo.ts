import { logger } from "./logger.ts";

/** Prazo máximo do desligamento; passado isso o processo sai mesmo com ciclos em voo. */
const PRAZO_DESLIGAMENTO_MS = 15_000;

/**
 * Handlers globais e desligamento ordenado, comuns à API e ao worker.
 * `encerrar` deve parar de aceitar trabalho, esperar o que está em voo e fechar conexões.
 */
export function instalarCicloDeVida(nome: string, encerrar: () => Promise<void>): void {
  let desligando = false;

  async function desligar(motivo: string, codigo: number) {
    if (desligando) return;
    desligando = true;
    logger.info({ motivo }, `${nome}: encerrando com segurança`);
    setTimeout(() => {
      logger.error({ prazoMs: PRAZO_DESLIGAMENTO_MS }, `${nome}: prazo de desligamento estourado; saindo à força`);
      process.exit(1);
    }, PRAZO_DESLIGAMENTO_MS).unref();
    try {
      await encerrar();
    } catch (err) {
      logger.error({ err }, `${nome}: erro durante o desligamento`);
      codigo = codigo || 1;
    }
    logger.flush();
    process.exit(codigo);
  }

  process.on("SIGINT", () => void desligar("SIGINT", 0));
  process.on("SIGTERM", () => void desligar("SIGTERM", 0));
  process.on("unhandledRejection", (razao) => {
    logger.fatal({ err: razao }, `${nome}: promise rejeitada sem tratamento`);
    void desligar("unhandledRejection", 1);
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, `${nome}: exceção não capturada`);
    void desligar("uncaughtException", 1);
  });
}
