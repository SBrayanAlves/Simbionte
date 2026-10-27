import type { Request, Response } from "express";
import { Errors } from "../../utils/errors.ts";
import * as service from "./simulacoes.service.ts";
import {
  criarAgenteSchema,
  criarSimulacaoSchema,
  idParamSchema,
  listarCiclosQuerySchema,
  numeroCicloParamSchema,
  obterCicloQuerySchema,
} from "./simulacoes.validators.ts";

function usuarioAutenticado(req: Request): number {
  if (!req.usuarioId) throw Errors.unauthorized();
  return req.usuarioId;
}

export async function criar(req: Request, res: Response) {
  const input = criarSimulacaoSchema.parse(req.body);
  const simulacao = await service.criarSimulacao(usuarioAutenticado(req), input);
  res.status(201).json({ simulacao });
}

export async function listar(req: Request, res: Response) {
  const simulacoes = await service.listarSimulacoes(usuarioAutenticado(req));
  res.status(200).json({ simulacoes });
}

export async function obter(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const simulacao = await service.obterSimulacao(usuarioAutenticado(req), id);
  res.status(200).json({ simulacao });
}

export async function criarAgente(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const input = criarAgenteSchema.parse(req.body);
  const agente = await service.criarAgente(usuarioAutenticado(req), id, input);
  res.status(201).json({ agente });
}

export async function listarAgentes(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const agentes = await service.listarAgentes(usuarioAutenticado(req), id);
  res.status(200).json({ agentes });
}

/** Serviço de início de ciclo: liga o laço contínuo e responde 202 sem esperar o ciclo. */
export async function iniciarCiclos(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const simulacao = await service.iniciarCiclos(usuarioAutenticado(req), id);
  res.status(202).json({ simulacao });
}

export async function pararCiclos(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const simulacao = await service.pararCiclos(usuarioAutenticado(req), id);
  res.status(200).json({ simulacao });
}

/** Executa um único ciclo de forma síncrona e devolve o resumo. */
export async function executarCiclo(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const ciclo = await service.executarCiclo(usuarioAutenticado(req), id);
  res.status(201).json({ ciclo });
}

export async function listarCiclos(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const query = listarCiclosQuerySchema.parse(req.query);
  const resultado = await service.listarCiclos(usuarioAutenticado(req), id, query);
  res.status(200).json(resultado);
}

export async function obterCiclo(req: Request, res: Response) {
  const { id, numero } = numeroCicloParamSchema.parse(req.params);
  const query = obterCicloQuerySchema.parse(req.query);
  const ciclo = await service.obterCiclo(usuarioAutenticado(req), id, numero, query);
  res.status(200).json({ ciclo });
}

export async function metricas(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const resultado = await service.obterMetricas(usuarioAutenticado(req), id);
  res.status(200).json({ metricas: resultado });
}
