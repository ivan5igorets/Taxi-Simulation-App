# syntax=docker/dockerfile:1

# --- build: сборка Vite-статики ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime: отдаём dist/ через nginx, проксируем /api на backend ---
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# Healthcheck задаётся в docker-compose.yml, не здесь — там же настройки backend
# и db, единый источник истины. Дублирование в обоих местах уже приводило к
# рассинхрону (Dockerfile тут не читался, потому что compose его перекрывает).

CMD ["nginx", "-g", "daemon off;"]
