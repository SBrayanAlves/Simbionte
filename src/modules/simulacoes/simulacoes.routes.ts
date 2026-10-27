import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.ts";
import { cicloManualRateLimit } from "../../middleware/rateLimit.ts";
import * as controller from "./simulacoes.controller.ts";

export const simulacoesRouter = Router();

simulacoesRouter.use("/simulacoes", authGuard);

simulacoesRouter.post("/simulacoes", controller.criar);
simulacoesRouter.get("/simulacoes", controller.listar);
simulacoesRouter.get("/simulacoes/:id", controller.obter);

simulacoesRouter.post("/simulacoes/:id/agentes", controller.criarAgente);
simulacoesRouter.get("/simulacoes/:id/agentes", controller.listarAgentes);

simulacoesRouter.post("/simulacoes/:id/ciclos/iniciar", controller.iniciarCiclos);
simulacoesRouter.post("/simulacoes/:id/ciclos/parar", controller.pararCiclos);
simulacoesRouter.post("/simulacoes/:id/ciclos/executar", cicloManualRateLimit, controller.executarCiclo);
simulacoesRouter.get("/simulacoes/:id/ciclos", controller.listarCiclos);
simulacoesRouter.get("/simulacoes/:id/ciclos/:numero", controller.obterCiclo);

simulacoesRouter.get("/simulacoes/:id/metricas", controller.metricas);
