const errorResponse = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string", example: "invalid_credentials" },
        message: { type: "string", example: "Credenciais inválidas" },
        details: { type: "object", additionalProperties: true },
      },
      required: ["code", "message"],
    },
  },
  required: ["error"],
};

const usuarioSchema = {
  type: "object",
  properties: {
    id: { type: "integer", example: 1 },
    nome: { type: "string", example: "Ana Teste" },
    email: { type: "string", format: "email", example: "ana@example.com" },
  },
  required: ["id", "nome", "email"],
};

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Simbionte — API de Autenticação",
    version: "1.0.0",
    description:
      "Endpoints de cadastro, login, renovação de sessão e logout do ecossistema Simbionte, expostos para consumo do Subgrupo B. " +
      "O access token é um JWT de curta duração (padrão 15 min) e deve ser enviado no header `Authorization: Bearer <token>`. " +
      "O refresh token é opaco, deve ser guardado com segurança pelo consumidor e é rotacionado a cada uso em `/auth/refresh`.",
  },
  servers: [{ url: "/", description: "Servidor local" }],
  tags: [
    { name: "Auth", description: "Cadastro, login, renovação de sessão e logout" },
    { name: "Sistema", description: "Endpoints operacionais" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    schemas: {
      Usuario: usuarioSchema,
      Error: errorResponse,
      RegisterRequest: {
        type: "object",
        properties: {
          nome: { type: "string", minLength: 2, maxLength: 120, example: "Ana Teste" },
          email: { type: "string", format: "email", example: "ana@example.com" },
          senha: { type: "string", minLength: 8, maxLength: 128, example: "senha1234" },
        },
        required: ["nome", "email", "senha"],
      },
      LoginRequest: {
        type: "object",
        properties: {
          email: { type: "string", format: "email", example: "ana@example.com" },
          senha: { type: "string", example: "senha1234" },
        },
        required: ["email", "senha"],
      },
      RefreshRequest: {
        type: "object",
        properties: {
          refreshToken: { type: "string" },
        },
        required: ["refreshToken"],
      },
      LogoutRequest: {
        type: "object",
        properties: {
          refreshToken: { type: "string" },
        },
        required: ["refreshToken"],
      },
      AuthTokens: {
        type: "object",
        properties: {
          accessToken: { type: "string", description: "JWT de curta duração (padrão 15 min)" },
          refreshToken: { type: "string", description: "Token opaco, rotacionado a cada uso" },
        },
        required: ["accessToken", "refreshToken"],
      },
    },
  },
  paths: {
    "/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Cadastra um novo usuário",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/RegisterRequest" } } },
        },
        responses: {
          "201": {
            description: "Usuário criado",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { usuario: { $ref: "#/components/schemas/Usuario" } },
                },
              },
            },
          },
          "400": { description: "Dados inválidos", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "409": { description: "E-mail já cadastrado", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "429": { description: "Muitas tentativas", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Autentica um usuário e emite os tokens de sessão",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } } },
        },
        responses: {
          "200": {
            description: "Login efetuado com sucesso",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { type: "object", properties: { usuario: { $ref: "#/components/schemas/Usuario" } } },
                    { $ref: "#/components/schemas/AuthTokens" },
                  ],
                },
              },
            },
          },
          "400": { description: "Dados inválidos", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Credenciais inválidas", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "429": { description: "Muitas tentativas", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Renova a sessão a partir de um refresh token válido",
        description:
          "O refresh token informado é invalidado (rotação) e um novo par access/refresh é emitido. " +
          "Reutilizar um refresh token já consumido resulta em 401.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/RefreshRequest" } } },
        },
        responses: {
          "200": {
            description: "Novo par de tokens emitido",
            content: { "application/json": { schema: { $ref: "#/components/schemas/AuthTokens" } } },
          },
          "400": { description: "Dados inválidos", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Refresh token inválido ou expirado", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Encerra a sessão revogando o refresh token",
        description:
          "Idempotente: chamar novamente com o mesmo token (já revogado) continua respondendo 204. " +
          "O access token já emitido permanece válido até expirar naturalmente (stateless).",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/LogoutRequest" } } },
        },
        responses: {
          "204": { description: "Sessão encerrada" },
          "400": { description: "Dados inválidos", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/me": {
      get: {
        tags: ["Auth"],
        summary: "Retorna os dados do usuário autenticado",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Usuário autenticado",
            content: {
              "application/json": {
                schema: { type: "object", properties: { usuario: { $ref: "#/components/schemas/Usuario" } } },
              },
            },
          },
          "401": { description: "Access token ausente, inválido ou expirado", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/health": {
      get: {
        tags: ["Sistema"],
        summary: "Verifica a saúde do serviço e suas dependências (Postgres, Redis, RabbitMQ)",
        responses: {
          "200": { description: "Todos os serviços operacionais" },
          "503": { description: "Um ou mais serviços indisponíveis" },
        },
      },
    },
  },
};
