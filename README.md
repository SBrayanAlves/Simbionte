# Simbionte — Backend

Backend do ecossistema de influência digital Simbionte: ambiente local (Postgres + Redis + RabbitMQ) e o módulo de autenticação (cadastro, login, renovação de sessão e logout), pronto para o Subgrupo B consumir.

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

## Fora de escopo desta entrega

Tabelas de `agents`, Game Loop, orquestração de LLM, WebSockets e RAG/pgvector ficam para as próximas entregas, conforme a documentação de arquitetura do projeto.
