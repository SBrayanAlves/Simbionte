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

const erro = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const simulacaoIdParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "integer" },
  description: "Identificador da simulação",
};

const ciclo = (descricao: string) => ({
  description: descricao,
  content: {
    "application/json": {
      schema: { type: "object", properties: { ciclo: { $ref: "#/components/schemas/Ciclo" } } },
    },
  },
});

const simulacaoResposta = (descricao: string) => ({
  description: descricao,
  content: {
    "application/json": {
      schema: { type: "object", properties: { simulacao: { $ref: "#/components/schemas/Simulacao" } } },
    },
  },
});

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Simbionte — API",
    version: "1.1.0",
    description:
      "Autenticação (cadastro, login, renovação e logout) e orquestração do ciclo de simulação (percepção e decisão) do ecossistema Simbionte, expostos para consumo do Subgrupo B. " +
      "O access token é um JWT de curta duração (padrão 15 min) e deve ser enviado no header `Authorization: Bearer <token>`. " +
      "O refresh token é opaco, deve ser guardado com segurança pelo consumidor e é rotacionado a cada uso em `/auth/refresh`.",
  },
  servers: [{ url: "/", description: "Servidor local" }],
  tags: [
    { name: "Auth", description: "Cadastro, login, renovação de sessão e logout" },
    { name: "Simulações", description: "Simulações e agentes participantes" },
    {
      name: "Ciclos",
      description:
        "Orquestrador do ciclo. Cada ciclo executa a fase de percepção (relatório de estado por agente) " +
        "e a fase de decisão (resposta JSON estruturada do módulo de conexão), registrando tudo na tabela de logs.",
    },
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
      Simulacao: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          nome: { type: "string", example: "Piloto 1" },
          intervaloSegundos: { type: "integer", example: 300, description: "Intervalo entre ciclos" },
          situacao: { type: "string", enum: ["CRIADA", "EXECUTANDO", "PAUSADA"] },
          emExecucao: { type: "boolean", description: "O laço contínuo está ativo neste processo" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      CriarSimulacaoRequest: {
        type: "object",
        properties: {
          nome: { type: "string", minLength: 2, maxLength: 120, example: "Piloto 1" },
          intervaloSegundos: {
            type: "integer",
            minimum: 1,
            maximum: 86400,
            description: "Padrão: CICLO_INTERVALO_PADRAO_SEGUNDOS (300)",
          },
        },
        required: ["nome"],
      },
      CriarAgenteRequest: {
        type: "object",
        properties: {
          nomeAgente: { type: "string", example: "Verificador Implacável" },
          provedorLlm: { type: "string", example: "openai" },
          promptAlma: {
            type: "string",
            minLength: 10,
            description: "Instrução estratégica do agente, enviada ao módulo de conexão a cada ciclo",
          },
        },
        required: ["nomeAgente", "provedorLlm", "promptAlma"],
      },
      Agente: {
        type: "object",
        properties: {
          id: { type: "integer" },
          simulacaoId: { type: "integer" },
          nomeAgente: { type: "string" },
          provedorLlm: { type: "string" },
          saldoMd: { type: "integer", example: 1000 },
          trustScore: { type: "number", example: 0.5 },
          ativo: { type: "boolean" },
        },
      },
      Ciclo: {
        type: "object",
        properties: {
          id: { type: "integer" },
          simulacaoId: { type: "integer" },
          numero: { type: "integer", example: 1 },
          situacao: { type: "string", enum: ["EM_ANDAMENTO", "CONCLUIDO", "FALHOU"] },
          inicio: { type: "string", format: "date-time" },
          fim: { type: "string", format: "date-time", nullable: true },
          duracaoMs: { type: "integer", nullable: true },
          totalAgentes: { type: "integer" },
          decisoesValidas: { type: "integer", description: "Decisões que passaram na validação do schema" },
          erro: { type: "string", nullable: true },
        },
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
    "/simulacoes": {
      post: {
        tags: ["Simulações"],
        summary: "Cria uma simulação",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CriarSimulacaoRequest" } } },
        },
        responses: {
          "201": simulacaoResposta("Simulação criada"),
          "400": erro("Dados inválidos"),
          "401": erro("Não autenticado"),
        },
      },
      get: {
        tags: ["Simulações"],
        summary: "Lista as simulações do usuário autenticado",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Simulações do usuário",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    simulacoes: { type: "array", items: { $ref: "#/components/schemas/Simulacao" } },
                  },
                },
              },
            },
          },
          "401": erro("Não autenticado"),
        },
      },
    },
    "/simulacoes/{id}": {
      get: {
        tags: ["Simulações"],
        summary: "Detalha uma simulação (agentes ativos e último ciclo)",
        security: [{ bearerAuth: [] }],
        parameters: [simulacaoIdParam],
        responses: {
          "200": simulacaoResposta("Simulação encontrada"),
          "401": erro("Não autenticado"),
          "404": erro("Simulação inexistente ou de outro usuário"),
        },
      },
    },
    "/simulacoes/{id}/agentes": {
      post: {
        tags: ["Simulações"],
        summary: "Adiciona um agente à simulação",
        security: [{ bearerAuth: [] }],
        parameters: [simulacaoIdParam],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CriarAgenteRequest" } } },
        },
        responses: {
          "201": {
            description: "Agente criado com saldo inicial de 1000 MD e TrustScore 0.5",
            content: {
              "application/json": {
                schema: { type: "object", properties: { agente: { $ref: "#/components/schemas/Agente" } } },
              },
            },
          },
          "400": erro("Dados inválidos"),
          "401": erro("Não autenticado"),
          "404": erro("Simulação inexistente ou de outro usuário"),
        },
      },
      get: {
        tags: ["Simulações"],
        summary: "Lista os agentes da simulação",
        security: [{ bearerAuth: [] }],
        parameters: [simulacaoIdParam],
        responses: {
          "200": {
            description: "Agentes da simulação",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { agentes: { type: "array", items: { $ref: "#/components/schemas/Agente" } } },
                },
              },
            },
          },
          "401": erro("Não autenticado"),
          "404": erro("Simulação inexistente ou de outro usuário"),
        },
      },
    },
    "/simulacoes/{id}/ciclos/iniciar": {
      post: {
        tags: ["Ciclos"],
        summary: "Inicia o laço contínuo de ciclos (serviço de início de ciclo)",
        description:
          "Liga o orquestrador para a simulação: o primeiro ciclo começa imediatamente e os seguintes a cada " +
          "`intervaloSegundos`, sempre depois que o anterior termina (nunca há dois ciclos simultâneos). " +
          "Responde 202 sem esperar o ciclo. Exige ao menos um agente ativo.",
        security: [{ bearerAuth: [] }],
        parameters: [simulacaoIdParam],
        responses: {
          "202": simulacaoResposta("Orquestrador iniciado"),
          "401": erro("Não autenticado"),
          "404": erro("Simulação inexistente ou de outro usuário"),
          "409": erro("`simulacao_em_execucao` ou `sem_agentes`"),
        },
      },
    },
    "/simulacoes/{id}/ciclos/parar": {
      post: {
        tags: ["Ciclos"],
        summary: "Para o laço contínuo",
        description: "Um ciclo em andamento termina normalmente; nenhum novo é iniciado. Idempotente.",
        security: [{ bearerAuth: [] }],
        parameters: [simulacaoIdParam],
        responses: {
          "200": simulacaoResposta("Orquestrador parado"),
          "401": erro("Não autenticado"),
          "404": erro("Simulação inexistente ou de outro usuário"),
        },
      },
    },
    "/simulacoes/{id}/ciclos/executar": {
      post: {
        tags: ["Ciclos"],
        summary: "Executa um único ciclo e aguarda o resultado",
        security: [{ bearerAuth: [] }],
        parameters: [simulacaoIdParam],
        responses: {
          "201": ciclo("Ciclo executado (situação CONCLUIDO; falhas individuais de agentes não derrubam o ciclo)"),
          "401": erro("Não autenticado"),
          "404": erro("Simulação inexistente ou de outro usuário"),
          "409": erro("`ciclo_em_andamento` ou `sem_agentes`"),
        },
      },
    },
    "/simulacoes/{id}/ciclos": {
      get: {
        tags: ["Ciclos"],
        summary: "Lista os ciclos (mais recentes primeiro)",
        security: [{ bearerAuth: [] }],
        parameters: [
          simulacaoIdParam,
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: {
          "200": {
            description: "Ciclos da simulação",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    total: { type: "integer" },
                    ciclos: { type: "array", items: { $ref: "#/components/schemas/Ciclo" } },
                  },
                },
              },
            },
          },
          "401": erro("Não autenticado"),
          "404": erro("Simulação inexistente ou de outro usuário"),
        },
      },
    },
    "/simulacoes/{id}/ciclos/{numero}": {
      get: {
        tags: ["Ciclos"],
        summary: "Detalha um ciclo com os logs de percepção e decisão de cada agente",
        description:
          "Cada log de PERCEPCAO traz o relatório de estado enviado ao agente. Cada log de DECISAO traz a " +
          "resposta validada (`detalhes.resposta`), a resposta bruta, o número de tentativas, o erro (se houve), " +
          "a latência e os tokens de entrada e saída.",
        security: [{ bearerAuth: [] }],
        parameters: [
          simulacaoIdParam,
          { name: "numero", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          "200": ciclo("Ciclo com logs"),
          "401": erro("Não autenticado"),
          "404": erro("Simulação ou ciclo inexistente"),
        },
      },
    },
    "/simulacoes/{id}/metricas": {
      get: {
        tags: ["Ciclos"],
        summary: "Métricas de desempenho e confiabilidade da simulação",
        description:
          "Total e taxa de sucesso dos ciclos, duração média e p95, taxa de decisões válidas, latência média e " +
          "p95 por decisão e total de tokens.",
        security: [{ bearerAuth: [] }],
        parameters: [simulacaoIdParam],
        responses: {
          "200": { description: "Métricas agregadas" },
          "401": erro("Não autenticado"),
          "404": erro("Simulação inexistente ou de outro usuário"),
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
