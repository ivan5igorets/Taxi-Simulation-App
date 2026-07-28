# syntax=docker/dockerfile:1

# --- deps: полный набор зависимостей (нужен tsx/typescript для сборки) ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build: компиляция TypeScript в dist/ ---
FROM deps AS build
COPY . .
RUN npm run build

# --- prod-deps: только прод-зависимости, без devDependencies ---
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- runtime: минимальный образ для запуска ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# curl нужен healthcheck'у ниже (alpine его не содержит по умолчанию).
RUN apk add --no-cache curl

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

EXPOSE 3100

# Healthcheck задаётся в docker-compose.yml — единый источник истины для всех
# сервисов, чтобы не рассинхронизироваться с Dockerfile (как уже случилось с frontend).

CMD ["node", "dist/server.js"]
