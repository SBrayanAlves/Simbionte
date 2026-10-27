# Simbionte — Backend

Backend do ecossistema de influência digital Simbionte: ambiente local (Postgres + Redis + RabbitMQ), módulo de autenticação (cadastro, login, renovação de sessão e logout) e orquestrador de ciclos (percepção e decisão), prontos para o Subgrupo B consumir.

## Pré-requisitos

- Node.js 22+
- Docker Desktop (com o daemon rodando)

## Subindo o ambiente

```bash
cp .env.example .env        # ajuste os valores se necessário
docker compose up -d        # sobe Postgres, Redis e RabbitMQ
npm install
npx prisma migrate dev      # aplica as migrations no banco
npm run dev                 # sobe o servidor com reload automático (porta 3000)
```

Verifique se tudo subiu corretamente em `GET http://localhost:3000/health` — deve retornar os três serviços como `ok`.

> **Nota sobre portas**: o Postgres do container é exposto em `localhost:55432` (em vez do padrão 5432) para não conflitar com instâncias nativas de Postgres que já possam estar rodando na máquina. O painel do RabbitMQ fica em `http://localhost:15672` (usuário/senha padrão em `.env.example`).

## Documentação da API

Com o servidor rodando, a documentação interativa (OpenAPI/Swagger) fica disponível em:

```
http://localhost:3000/docs
```

Ela cobre todos os endpoints abaixo, com schemas de request/response e exemplos.

## Endpoints de autenticação

| Método | Rota            | Descrição                                              |
| ------ | --------------- | ------------------------------------------------------- |
| POST   | `/auth/register` | Cadastra um usuário (`nome`, `email`, `senha`)          |
| POST   | `/auth/login`     | Autentica e retorna `accessToken` + `refreshToken`      |
| POST   | `/auth/refresh`   | Troca um `refreshToken` válido por um novo par de tokens (rotação) |
| POST   | `/auth/logout`    | Revoga um `refreshToken` (idempotente)                  |
| GET    | `/me`             | Retorna o usuário autenticado (`Authorization: Bearer <accessToken>`) |
| GET    | `/health`         | Checa Postgres, Redis e RabbitMQ                         |

### Estratégia de sessão

- **Access token**: JWT, expira em 15 minutos (configurável via `JWT_ACCESS_TTL_MINUTES`), enviado como `Authorization: Bearer <token>`. Stateless — não é possível revogar antes de expirar.
- **Refresh token**: opaco (não é JWT), TTL de 7 dias (configurável via `JWT_REFRESH_TTL_DAYS`), guardado no Redis (hash SHA-256, nunca em texto puro). É **rotacionado a cada uso**: ao chamar `/auth/refresh`, o token enviado é invalidado e um novo é devolvido. Reutilizar um refresh token já consumido retorna 401.
- `/auth/register` e `/auth/login` têm rate limiting (20 requisições / 15 min por IP).

## Variáveis de ambiente

Veja `.env.example` para a lista completa (`DATABASE_URL`, `REDIS_URL`, `RABBITMQ_URL`, `JWT_ACCESS_SECRET`, `CORS_ORIGINS`, etc.). Ajuste `CORS_ORIGINS` para incluir a origem do serviço/frontend do Subgrupo B.

## Testes

```bash
npm test
```

Roda a suíte de integração (`tests/auth.e2e.test.ts`) contra o ambiente Docker local, cobrindo o fluxo completo (cadastro → login → rota protegida → renovação → logout) e os principais casos de erro.

## Orquestrador de ciclos (Etapa 5)

O orquestrador roda como serviço dentro do processo do backend e executa as duas primeiras fases do Game Loop para cada simulação:

1. **Percepção** — uma única leitura do banco por ciclo monta o relatório de estado de cada agente: dia da simulação, inventário (Modelas e TrustScore), ranking, tópicos em alta e as 3 ações mais impactantes do ciclo anterior.
2. **Decisão** — o relatório e a instrução estratégica do agente (Prompt-Alma) são enviados ao módulo de conexão (`LlmGateway`). A resposta é validada contra o protocolo estruturado do Subgrupo C (`action`, `parameters.target/value`, `rationale`, `metadata`) e as cinco ações do documento de pesquisa. Resposta inválida, erro ou timeout geram nova tentativa; esgotadas as tentativas, o agente fica `OCIOSO` no ciclo e a falha é registrada. Um agente com problema nunca trava o ciclo.

Garantias de projeto:

- **Sem sobreposição**: o próximo ciclo só é agendado depois que o anterior termina; `(simulacao_id, numero)` é único no banco.
- **Intervalo configurável** por simulação (`intervaloSegundos`) e padrão global em `CICLO_INTERVALO_PADRAO_SEGUNDOS`. Mudanças valem a partir do ciclo seguinte.
- **Recuperação de queda**: ao subir, ciclos que ficaram `EM_ANDAMENTO` viram `FALHOU` e simulações `EXECUTANDO` são retomadas.
- **Rastreabilidade**: a tabela `logs` guarda, por agente e ciclo, o relatório enviado, a resposta bruta e a validada, tentativas, erro, latência e tokens.

### Endpoints (todos exigem `Authorization: Bearer <accessToken>`)

| Método | Rota                                 | Descrição                                                              |
|--------|--------------------------------------|------------------------------------------------------------------------|
| POST   | `/simulacoes`                        | Cria uma simulação (`nome`, `intervaloSegundos` opcional)              |
| GET    | `/simulacoes`, `/simulacoes/:id`     | Lista / detalha simulações do usuário                                  |
| POST   | `/simulacoes/:id/agentes`            | Adiciona agente (`nomeAgente`, `provedorLlm`, `promptAlma`)            |
| GET    | `/simulacoes/:id/agentes`            | Lista agentes                                                          |
| POST   | `/simulacoes/:id/ciclos/iniciar`     | **Serviço de início de ciclo**: liga o laço contínuo (202)             |
| POST   | `/simulacoes/:id/ciclos/parar`       | Para o laço                                                            |
| POST   | `/simulacoes/:id/ciclos/executar`    | Executa um único ciclo e devolve o resultado                           |
| GET    | `/simulacoes/:id/ciclos`             | Lista ciclos (`limit`, `offset`)                                       |
| GET    | `/simulacoes/:id/ciclos/:numero`     | Ciclo com todos os logs de percepção e decisão                         |
| GET    | `/simulacoes/:id/metricas`           | Taxa de sucesso, duração média/p95, decisões válidas, latência, tokens |

### Módulo de conexão com os LLMs

O contrato está em `src/modules/ciclos/tipos.ts` (`LlmGateway`). Por enquanto só existe o gateway `stub` (`LLM_GATEWAY=stub`, o padrão), que gera respostas determinísticas sem chamar provedor algum e aceita marcadores no Prompt-Alma para simular falhas em testes (`[[STUB:INVALIDO]]`, `[[STUB:ERRO]]`, `[[STUB:LENTO]]`, `[[STUB:ATRASO=ms]]`). Um provedor real entra implementando `LlmGateway` e registrando-se em `criarGateway()` (`gateway.ts`).

### Aplicando as migrations

```
npx prisma migrate dev      # aplica 20261026230000_etapa5_ciclos
```

## Fora de escopo desta entrega

Fases de ação, resolução e log do Game Loop (execução das ações, engajamento, atualização de saldo e TrustScore), tabelas de conceitos, posts, comentários e verificações, `agent_metrics_history`, criptografia AES-256-GCM das chaves de API (a coluna `chave_api_criptografada` já existe, mas nada a preenche ainda), WebSockets e RAG/pgvector ficam para as próximas entregas, conforme a documentação de arquitetura do projeto.
