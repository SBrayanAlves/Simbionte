# Simbionte — Backend

Backend do ecossistema de influência digital Simbionte: ambiente local (Postgres + Redis + RabbitMQ), módulo de autenticação (cadastro, login, renovação de sessão e logout) e orquestrador de ciclos (percepção e decisão), prontos para o Subgrupo B consumir.

## Pré-requisitos

- **Node.js 22.18 ou mais novo** (o projeto executa TypeScript direto, sem build; versões 22.0 a 22.17 não suportam isso). O `.nvmrc` indica a versão usada no desenvolvimento e o `npm install` recusa versões antigas (`engine-strict`).
- Docker Desktop (com o daemon rodando)

## Subindo o ambiente

```bash
npm run setup               # cria o .env a partir do .env.example, com senhas e segredo JWT aleatórios
docker compose up -d        # sobe Postgres, Redis e RabbitMQ (só em 127.0.0.1)
npm install                 # instala as dependências e gera o client do Prisma (postinstall)
npx prisma migrate dev      # aplica as migrations no banco
npm run dev                 # sobe a API com reload automático (porta 3000)
npm run worker:dev          # em outro terminal: sobe o worker que executa os ciclos
```

> `npm run setup` só usa Node, então funciona antes do `npm install`. Ele nunca sobrescreve um `.env` existente. Se preferir copiar à mão (`cp .env.example .env`), troque todos os `troque-me-*` e preencha `JWT_ACCESS_SECRET` (ex.: `openssl rand -hex 32`).

Verifique se tudo subiu em `GET http://localhost:3000/health`: deve responder `200` com `{"status":"ok"}`. O estado de cada serviço fica em `GET /health/detalhes` (exige `Authorization: Bearer <accessToken>`).

> **Portas e rede**: todos os serviços do `docker-compose.yml` escutam apenas em `127.0.0.1`, nada fica exposto para a rede local. O Postgres usa `localhost:55432` (em vez de 5432) para não conflitar com instâncias nativas. O Redis exige senha (`REDIS_PASSWORD`). O painel do RabbitMQ fica em `http://localhost:15672` (usuário e senha no seu `.env`).
>
> **Atualizando um ambiente antigo**: as senhas padrão `simbionte/simbionte` deixaram de existir. Se os volumes do Docker foram criados com elas, o Postgres e o RabbitMQ continuam com a senha antiga. Para recomeçar do zero (apaga os dados locais): `docker compose down -v` e depois os passos acima. Refresh tokens emitidos antes desta versão deixam de valer (é preciso logar de novo).

## Documentação da API

Com o servidor rodando, a documentação interativa (OpenAPI/Swagger) fica em `http://localhost:3000/docs`. Em produção ela é desligada por padrão (`DOCS_HABILITADO=true` religa).

## Endpoints de autenticação

| Método | Rota                | Descrição                                                                   |
| ------ | ------------------- | --------------------------------------------------------------------------- |
| POST   | `/auth/register`    | Cadastra um usuário (`nome`, `email`, `senha`)                              |
| POST   | `/auth/login`       | Autentica e retorna `accessToken` + `refreshToken`                          |
| POST   | `/auth/refresh`     | Troca um `refreshToken` válido por um novo par de tokens (rotação)          |
| POST   | `/auth/logout`      | Revoga um `refreshToken` (idempotente)                                      |
| POST   | `/auth/logout-all`  | Encerra todas as sessões do usuário autenticado                             |
| GET    | `/me`               | Retorna o usuário autenticado (`Authorization: Bearer <accessToken>`)       |
| GET    | `/health`           | Saúde da API (público, sem detalhes)                                        |
| GET    | `/health/detalhes`  | Estado de Postgres, Redis e RabbitMQ (autenticado)                          |

### Estratégia de sessão

- **Access token**: JWT HS256 com `iss` e `aud` verificados, expira em 15 minutos (`JWT_ACCESS_TTL_MINUTES`), enviado como `Authorization: Bearer <token>`. Stateless: não é possível revogar antes de expirar.
- **Refresh token**: opaco (não é JWT), TTL de 7 dias (`JWT_REFRESH_TTL_DAYS`), guardado no Redis (hash SHA-256, nunca em texto puro). É **rotacionado a cada uso** com uma operação atômica: dez renovações simultâneas com o mesmo token geram exatamente um sucesso.
- **Detecção de reuso**: cada login abre uma "família" de tokens. Reapresentar um refresh token já consumido indica vazamento: a família inteira é revogada e o usuário precisa logar de novo.
- **Senha**: bcrypt custo 12, no máximo 72 bytes (o limite do bcrypt; acima disso senhas diferentes seriam equivalentes). O login leva o mesmo tempo para e-mail inexistente e para senha errada.
- O cadastro responde `409` para e-mail já usado. É intencional (o usuário precisa saber), e o rate limit do cadastro limita a enumeração.
- **Rate limit** por IP, janela de 15 minutos: cadastro 20, login 20 falhas (logins bem-sucedidos não contam), refresh + logout 60. Execução manual de ciclo: 10 por minuto por usuário. Tudo configurável no `.env`. Em produção o contador fica no Redis (vale entre instâncias); atrás de proxy reverso, ajuste `TRUST_PROXY`.

## Variáveis de ambiente

Veja `.env.example` para a lista completa e comentada. Ajuste `CORS_ORIGINS` para incluir a origem do front-end do Subgrupo B. Em `NODE_ENV=production` a aplicação se recusa a subir com o segredo JWT de exemplo, com segredo de menos de 32 caracteres ou com as senhas `troque-me-*`.

## Testes e qualidade

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # Biome
npm test            # prepara o banco de testes e roda unitários + integração
```

Os testes **não usam o banco nem o Redis de desenvolvimento**: rodam em `<POSTGRES_DB>_test` e no banco lógico 1 do Redis, derivados do `.env` (ou de `TEST_DATABASE_URL` / `TEST_REDIS_URL`). O `pretest` aplica as migrations nesse banco. As configurações de teste ficam em `.env.test` (versionado, sem segredos).

- `tests/unidade.test.ts`: percepção, sanitização, protocolo, prompt, contrato do gateway e validação do ambiente, sem banco.
- `tests/auth.e2e.test.ts` e `tests/ciclos.e2e.test.ts`: fluxos completos contra Postgres e Redis.
- `tests/auditoria.regressao.test.ts`: critérios de aceite da auditoria P0–P4. Se um falhar, o achado voltou.

O GitHub Actions (`.github/workflows/ci.yml`) roda typecheck, lint, `npm audit --audit-level=high` e os testes, com Postgres e Redis, em todo push no `main` e em pull requests.

## Orquestrador de ciclos (Etapa 5)

O Game Loop roda num **worker separado da API** (`npm run worker`), como define a arquitetura da Etapa 2. A API só muda a `situacao` da simulação (iniciar/parar) e permite executar um ciclo avulso. O worker executa as duas primeiras fases do Game Loop para cada simulação:

1. **Percepção**: uma única leitura do banco por ciclo monta o relatório de estado de cada agente: dia da simulação, inventário (Modelas e TrustScore), ranking, tópicos em alta e as 3 ações mais impactantes do ciclo anterior.
2. **Decisão**: o relatório e a instrução estratégica do agente (Prompt-Alma) são enviados ao módulo de conexão (`LlmGateway`). A resposta é validada contra o protocolo estruturado do Subgrupo C (`action`, `parameters.target/value`, `rationale`, `metadata`) e as cinco ações do documento de pesquisa. Resposta inválida, erro ou timeout geram nova tentativa; esgotadas as tentativas, o agente fica `OCIOSO` no ciclo e a falha é registrada. Um agente com problema nunca trava o ciclo.

Garantias de projeto:

- **Sem sobreposição, mesmo com vários workers**: antes de cada ciclo o processo toma uma trava da simulação no Postgres (`pg_try_advisory_lock`) e confere, sob a trava, se o último ciclo começou há mais de um intervalo. Dois workers ao mesmo tempo produzem um único ciclo por vez e não multiplicam a frequência. `(simulacao_id, numero)` é único no banco.
- **Intervalo configurável** por simulação (`intervaloSegundos`), com padrão global em `CICLO_INTERVALO_PADRAO_SEGUNDOS` e mínimo em `INTERVALO_MINIMO_SEGUNDOS` (30 s em produção). Mudanças valem a partir do ciclo seguinte.
- **Cotas**: `MAX_SIMULACOES_POR_USUARIO` (5) e `MAX_AGENTES_POR_SIMULACAO` (50). Exceder responde `422`.
- **Recuperação de queda**: um ciclo `EM_ANDAMENTO` cuja trava está livre é órfão (o processo que o rodava caiu) e vira `FALHOU`. Um ciclo vivo em outro worker segura a trava e nunca é marcado. Simulações `EXECUTANDO` são retomadas.
- **Robustez da resposta**: caracteres que o Postgres recusa (NUL, surrogates soltos) são removidos; `rationale` tem até 2.000 caracteres, `metadata` e `parameters` até 4 KB e a resposta bruta até 16.000 caracteres.
- **Proteção contra Prompt Injection cruzado** (relatório do Subgrupo D): o que um agente escreve e outros leem (`parameters.target` e `nomeAgente`) só aceita letras, números, espaço e `_ . , -`, até 64 caracteres, e não pode conter padrões de injeção ("ignore", "prompt-alma", ...). O relatório vai para o LLM num bloco delimitado, declarado como dados e nunca como instruções. Respostas com padrões suspeitos ficam marcadas em `logs.detalhes.alertas` para auditoria.
- **Rastreabilidade**: a tabela `logs` guarda, por agente e ciclo, a resposta bruta e a validada, tentativas, erro, alertas, latência e tokens. A parte do relatório comum a todos os agentes é gravada uma vez por ciclo (`ciclo.relatorio_comum`); por agente, só o bloco `agente`.
- **Retenção**: o worker apaga a cada hora os logs de `PERCEPCAO` com mais de `LOGS_PERCEPCAO_RETENCAO_DIAS` (30). Os de `DECISAO` ficam (são a base das métricas).
- **Eventos**: o worker publica `ciclo.concluido` e `ciclo.falhou`, e a API publica `simulacao.situacao`, no exchange `simbionte.eventos` (topic) do RabbitMQ, para o front-end atualizar sem consultar a API em laço. A conexão reconecta sozinha (1 s a 30 s).

### Endpoints (todos exigem `Authorization: Bearer <accessToken>`)

| Método | Rota                                 | Descrição                                                              |
|--------|--------------------------------------|------------------------------------------------------------------------|
| POST   | `/simulacoes`                        | Cria uma simulação (`nome`, `intervaloSegundos` opcional)              |
| GET    | `/simulacoes`, `/simulacoes/:id`     | Lista / detalha simulações do usuário                                  |
| POST   | `/simulacoes/:id/agentes`            | Adiciona agente (`nomeAgente`, `provedorLlm`, `promptAlma`)            |
| GET    | `/simulacoes/:id/agentes`            | Lista agentes                                                          |
| POST   | `/simulacoes/:id/ciclos/iniciar`     | **Serviço de início de ciclo**: liga o laço contínuo no worker (202)  |
| POST   | `/simulacoes/:id/ciclos/parar`       | Para o laço                                                            |
| POST   | `/simulacoes/:id/ciclos/executar`    | Executa um único ciclo e devolve o resultado                           |
| GET    | `/simulacoes/:id/ciclos`             | Lista ciclos (`limit`, `offset`)                                       |
| GET    | `/simulacoes/:id/ciclos/:numero`     | Ciclo com logs paginados (`fase`, `agentId`, `limit` até 500, `offset`, `detalhes=true`) |
| GET    | `/simulacoes/:id/metricas`           | Taxa de sucesso, duração média/p95, decisões válidas, latência, tokens |

### Módulo de conexão com os LLMs

O contrato está em `src/modules/ciclos/tipos.ts` (`LlmGateway`). Por enquanto só existe o gateway `stub` (`LLM_GATEWAY=stub`, o padrão), que gera respostas determinísticas sem chamar provedor algum e aceita marcadores no Prompt-Alma para simular falhas em testes (`[[STUB:INVALIDO]]`, `[[STUB:ERRO]]`, `[[STUB:LENTO]]`, `[[STUB:ATRASO=ms]]`). Um provedor real entra implementando `LlmGateway` e registrando-se em `criarGateway()` (`gateway.ts`). A implementação **precisa respeitar `pedido.signal`** (repassá-lo ao `fetch` do provedor): depois do timeout o motor já descartou a resposta. `tests/gateway.contrato.ts` tem um teste de contrato reutilizável para validar isso.

## Deploy

O `Dockerfile` (multi-stage) gera a imagem da API; o mesmo serviço roda o worker com `node src/worker.ts`. Para subir tudo em contêineres:

```bash
docker compose --profile app up -d --build   # migrate (prisma migrate deploy) -> api + worker
```

Em produção:

- defina `NODE_ENV=production`, um `JWT_ACCESS_SECRET` de 32+ caracteres e senhas próprias para Postgres, Redis e RabbitMQ;
- rode as migrations com `npx prisma migrate deploy` antes de subir a nova versão (o serviço `migrate` do compose faz isso);
- coloque a API **atrás de um proxy reverso com TLS** (Nginx, Traefik, Caddy). A API fala HTTP puro e não deve ser exposta diretamente; configure `TRUST_PROXY` com o número de saltos de proxy (ex.: `1`) para o rate limit enxergar o IP real do cliente;
- rode quantos workers quiser (`docker compose --profile app up -d --scale worker=2`): a trava por simulação evita ciclos duplicados;
- logs saem em JSON (pino), um por linha, com `req.id` (também devolvido no header `x-request-id`) e, no orquestrador, `simulacaoId` e `ciclo`.

## Fora de escopo desta entrega

Fases de ação, resolução e log do Game Loop (execução das ações, engajamento, atualização de saldo e TrustScore), tabelas de conceitos, posts, comentários e verificações, `agent_metrics_history`, criptografia AES-256-GCM das chaves de API (a coluna `chave_api_criptografada` já existe, mas nada a preenche ainda), WebSockets e RAG/pgvector ficam para as próximas entregas, conforme a documentação de arquitetura do projeto. Decisões pendentes e riscos aceitos estão em [`Documentation/DECISOES.md`](Documentation/DECISOES.md).

## Licença

Ainda não definida pelo grupo (`"license": "UNLICENSED"` no `package.json`, o que equivale a "todos os direitos reservados"). Ver `Documentation/DECISOES.md`.
