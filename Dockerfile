# syntax=docker/dockerfile:1

# --- build: dependências completas + client do Prisma (também usado pelo serviço "migrate")
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY src ./src
RUN npx prisma generate

# --- prod-deps: só dependências de produção (o CLI do Prisma fica de fora)
FROM build AS prod-deps
RUN npm prune --omit=dev

# --- runtime: API (padrão) ou worker (`node src/worker.ts`)
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "src/server.ts"]
