# Implementação da auditoria P0–P4 — Simbionte (Subgrupo A)

Registro do que foi feito no repositório para atender a cada achado da
*Auditoria de código P0–P4 — Simbionte (Subgrupo A)*. As decisões que ficaram
com o grupo e os riscos aceitos estão em [`DECISOES.md`](DECISOES.md).

**Situação:** 34 achados tratados. P3-08 e a escolha da licença (P4-01)
aguardam decisão.

---

## Verificação

| Verificação | Resultado |
|---|---|
| Testes (`npm test`) | 42/42 passando. Nenhum `todo` sobrou em `tests/auditoria.regressao.test.ts` |
| Typecheck (`npm run typecheck`) | 0 erros |
| Lint (`npm run lint`, Biome) | 0 erros e 0 avisos |
| `npm audit` | 0 vulnerabilidades (antes: 14, sendo 1 crítica e 8 altas) |
| Clone limpo (P0-01) | Seguindo o README do zero, o client Prisma é gerado no `postinstall`, as migrations são aplicadas e a API sobe |
| Espaço em `logs` por ciclo, 200 agentes (P2-05) | 348,6 KB → 158,5 KB (−54,5%) |
| Dois workers em paralelo | Um ciclo por vez, sem dobrar a frequência: 5 ciclos em 10 s com intervalo de 2 s |

### Pontos que não puderam ser validados localmente

A máquina de desenvolvimento não tinha Docker. Os testes rodaram contra um
Postgres 18 embutido e um servidor Redis simulado. Por isso:

- os scripts Lua do refresh token (`LUA_CONSUMIR`, `LUA_REVOGAR_FAMILIA`) ainda não
  rodaram num Redis real. O CI vai executá-los.
- `docker compose`, o build do `Dockerfile` e o workflow de CI não foram executados.
  Só o YAML foi validado.
- A reconexão do RabbitMQ foi vista apenas tentando de novo e falhando, nunca
  reconectando de fato.
- O compose usa Postgres 16, mas os testes rodaram no 18.

---

## Achados e o que foi feito

### P0 — Bloqueante

| ID | Achado | Implementação |
|---|---|---|
| P0-01 | Clone novo não sobe | `postinstall: prisma generate` em `package.json`. Novo script `npm run setup` (`scripts/setup-env.ts`), que cria o `.env` a partir do `.env.example` |

### P1 — Crítico

| ID | Achado | Implementação |
|---|---|---|
| P1-01 | Refresh token reutilizável sob concorrência | Consumo atômico por script Lua: `GETDEL` mais a marca de token usado, numa única operação (`src/modules/auth/tokens.ts`) |
| P1-02 | Infra aberta na rede com senha padrão | Portas do compose presas em `127.0.0.1`. As senhas passaram a ser obrigatórias (`${VAR:?...}`). O Redis agora exige senha (`--requirepass`). O `.env.example` usa marcadores `troque-me-*`, que o `setup` substitui por valores aleatórios |
| P1-03 | NUL de um agente derruba o ciclo | `limpar()` em `decisao.ts` aplica `toWellFormed()` e remove `\u0000` de chaves e valores, de forma recursiva, antes e depois do parse |
| P1-04 | Injeção de prompt cruzada | Na escrita: `target` e nomes de agente só aceitam o padrão `TEXTO_COMPARTILHADO` (`tipos.ts`), a resposta tem limites de tamanho e respostas com padrões de injeção são rejeitadas. Na percepção: nomes e alvos são sanitizados (`alvoSeguro`). No prompt: o conteúdo fica entre os delimitadores `INICIO_DADOS`/`FIM_DADOS`, e o prompt de sistema diz que esse trecho é dado, nunca instrução. Os alertas de injeção ficam registrados no log da decisão |
| P1-05 | 14 vulnerabilidades | `npm audit fix` e Prisma alinhado em 7.10.1. O CI roda `npm audit --audit-level=high` |
| P1-06 | Sem limites de uso | Cotas `MAX_SIMULACOES_POR_USUARIO` e `MAX_AGENTES_POR_SIMULACAO`, que devolvem 422 `limite_simulacoes` / `limite_agentes`. Intervalo mínimo `INTERVALO_MINIMO_SEGUNDOS` (30 s em produção), que devolve 422 `intervalo_abaixo_do_minimo`. Rate limit no ciclo manual, por usuário |

### P2 — Alto

| ID | Achado | Implementação |
|---|---|---|
| P2-01 | Orquestrador dentro do processo web | Novo processo `src/worker.ts` (`npm run worker`). A API só altera a situação da simulação no banco, e o worker sincroniza a cada `WORKER_SINCRONIZACAO_SEGUNDOS`. A exclusão entre processos usa a trava `pg_try_advisory_lock` (`src/db/travas.ts`). Sob a trava, o worker confere quando começou o último ciclo (`CicloAdiado`), o que impede vários workers de multiplicar a frequência |
| P2-02 | Segredo JWT de exemplo aceito em produção | Em `env.ts`, produção recusa segredo com menos de 32 caracteres, o segredo de exemplo antigo e URLs com `troque-me` |
| P2-03 | Tempo do login revela e-mails | Um hash bcrypt fictício é comparado quando o e-mail não existe, para o tempo de resposta ser o mesmo |
| P2-04 | Detalhe do ciclo sem paginação | `GET .../ciclos/:numero` aceita `fase`, `agentId`, `limit` (padrão 100, máximo 500) e `offset`. Devolve `totalLogs`, e os `detalhes` da percepção só vêm com `detalhes=true` |
| P2-05 | `logs` cresce sem retenção | A parte comum do relatório é gravada uma vez por ciclo, em `ciclo.relatorio_comum`, e cada log de percepção guarda só `{agente}`. O worker apaga logs de percepção antigos de hora em hora (`retencao.ts`, `LOGS_PERCEPCAO_RETENCAO_DIAS`, em lotes de 5000). Novo índice `(fase, created_at)` |
| P2-06 | RabbitMQ sem reconexão e sem uso | Reconexão com backoff de 1 s a 30 s. O exchange `simbionte.eventos` (topic) passa a publicar `ciclo.concluido`, `ciclo.falhou` e `simulacao.situacao` |
| P2-07 | Rate limit incompleto | Limites separados para cadastro, login (`skipSuccessfulRequests`), refresh/logout e ciclo manual. Em produção os contadores usam `rate-limit-redis`, e todos os limites podem ser ajustados por variável de ambiente |
| P2-08 | Versão do Node não declarada | `engines >=22.18`, `.npmrc` com `engine-strict=true` e `.nvmrc` com `24` |

### P3 — Médio

| ID | Achado | Implementação |
|---|---|---|
| P3-01 | Entradas inválidas retornam 500 | O `errorHandler` passa a responder 400 `invalid_json`, 413 `payload_too_large` e 415. Os ids são limitados a `INT4_MAX`, e o tamanho do corpo a `100kb` |
| P3-02 | bcrypt trunca em 72 bytes | No cadastro, a senha é validada por `Buffer.byteLength <= 72` |
| P3-03 | Sem detecção de reuso nem logout global | Cada login abre uma família de tokens, rastreada no Redis (`familia:<f>` e `sessoes:<id>`). Reusar um token consumido revoga a família inteira. Novo endpoint `POST /auth/logout-all` |
| P3-04 | JWT sem algoritmo, `iss` e `aud` | `HS256` fixo, com `issuer: simbionte` e `audience: simbionte-api` exigidos tanto no `sign` quanto no `verify` |
| P3-05 | Faltam `CHECK` | A migration `20261027000000_auditoria` cria `CHECK` para `trust_score`, `saldo_md`, `intervalo_segundos`, `numero`, `total_agentes` e `decisoes_validas` |
| P3-06 | Sem typecheck, lint e CI | Scripts `typecheck` e `lint` (Biome, configurado em `biome.json`). O workflow `.github/workflows/ci.yml` sobe Postgres 16 e Redis 7 e roda `npm ci`, typecheck, lint, `npm audit` e os testes |
| P3-07 | Testes sem isolamento | Os testes usam o banco `<db>_test` e o banco lógico 1 do Redis (`ambienteTeste.ts`), com configuração em `.env.test`. O `pretest` aplica as migrations no banco de teste, cada teste limpa o que criou e os limites de rate limit ficam altos em teste |
| P3-08 | Propriedade x ecossistema compartilhado | **Pendente de decisão.** Registrado em `DECISOES.md` |
| P3-09 | Sem handlers globais nem prazo no desligamento | `instalarCicloDeVida` (`src/utils/processo.ts`) trata `SIGINT`, `SIGTERM`, `unhandledRejection` e `uncaughtException`, com prazo de 15 s para encerrar. O desligamento também fecha o RabbitMQ e as travas |
| P3-10 | Transação do ciclo com timeout padrão | `timeout: 30000` na transação, com `createMany` em lotes de 500 |
| P3-11 | `/docs` e `/health` públicos | `/health` devolve só `{status}`. O detalhe por serviço foi para `/health/detalhes`, que exige login. `/docs` só é servido quando `DOCS_HABILITADO` está ligado |

### P4 — Baixo

| ID | Achado | Implementação |
|---|---|---|
| P4-01 | `package.json` inconsistente | `main` removido e `description` atualizada. A licença ficou provisoriamente como `UNLICENSED` com `private: true` e **aguarda a escolha da licença definitiva** |
| P4-02 | Coluna `senha` guarda hash | Campo renomeado para `senhaHash`, com `@map("senha_hash")` e `RENAME COLUMN` na migration |
| P4-03 | Logs sem estrutura | `pino` com redação de campos sensíveis (`src/utils/logger.ts`) e `pino-http` com `x-request-id`. O orquestrador inclui `simulacaoId` e `ciclo` nos logs |
| P4-04 | Ciclos vazios sem agentes | Quando não há agentes ativos, o ciclo é pulado e um aviso vai para o log (`sem_agentes`) |
| P4-05 | Corrida em `iniciar()` | O status é trocado por um `updateMany` atômico (`where situacao != EXECUTANDO`). Se nada mudar, a resposta é 409 |
| P4-06 | Contrato do `signal` não documentado | O contrato está documentado em `tipos.ts`, o gateway stub respeita o abort e há um teste de contrato reutilizável (`tests/gateway.contrato.ts`) |
| P4-07 | Falta teste da percepção | `derivarPercepcao` virou uma função pura, coberta pelos testes unitários em `tests/unidade.test.ts`. O `retomar()` com várias simulações tem teste e2e |
| P4-08 | Sem Dockerfile nem guia de deploy | `Dockerfile` multi-stage (`node:24-alpine`) e `.dockerignore`. O compose ganhou o perfil `app` (`migrate`, `api`, `worker`), e o README tem uma seção sobre deploy, TLS e `TRUST_PROXY` |

---

## Mudanças que afetam quem usa a API

Avisar o Subgrupo B:

- `/health` devolve só o status. O detalhe por serviço está em `/health/detalhes`, que exige login.
- O detalhe do ciclo é paginado e traz a parte comum do relatório em `relatorioComum`.
- Os refresh tokens emitidos antes desta versão perdem a validade, então todos os usuários precisam fazer login de novo.
- Novo endpoint `POST /auth/logout-all`.
- Novos erros: 422 (cotas e intervalo mínimo) e 429 (rate limit).

## Mudanças no ambiente de desenvolvimento

- Primeiro passo: `npm run setup`, que gera o `.env` com senhas aleatórias.
- Os ciclos automáticos agora rodam em `npm run worker` (ou `npm run worker:dev`).
- Quem já tinha o ambiente local precisa rodar `docker compose down -v` para os
  contêineres adotarem as novas senhas. **Esse comando apaga os dados locais.**
- Testes: basta `npm test`, que usa o banco `<db>_test` e o Redis banco 1, sem
  tocar nos dados de desenvolvimento.

## Arquivos novos

- **Configuração:** `.dockerignore`, `.env.test`, `.npmrc`, `.nvmrc`, `biome.json`, `Dockerfile`
- **CI:** `.github/workflows/ci.yml`
- **Scripts:** `scripts/setup-env.ts`, `scripts/test-db.ts`
- **Migration:** `prisma/migrations/20261027000000_auditoria/migration.sql`
- **Código:**
  - `src/config/ambienteTeste.ts`
  - `src/db/travas.ts`
  - `src/modules/ciclos/retencao.ts`
  - `src/utils/logger.ts`
  - `src/utils/processo.ts`
  - `src/worker.ts`
- **Testes:** `tests/unidade.test.ts`, `tests/gateway.contrato.ts`
- **Documentação:** `Documentation/DECISOES.md` e este arquivo
