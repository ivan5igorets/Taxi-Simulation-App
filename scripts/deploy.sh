#!/usr/bin/env bash
# Обновление прод-деплоя на дроплете: подтягивает код и пересобирает то, что изменилось.
# Запускать НА СЕРВЕРЕ из корня репозитория: ./scripts/deploy.sh

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Ошибка: .env не найден в корне репозитория." >&2
  echo "Скопируй .env.example в .env и задай POSTGRES_PASSWORD перед первым деплоем." >&2
  exit 1
fi

if [ ! -f backend/.env ]; then
  echo "Ошибка: backend/.env не найден." >&2
  echo "Скопируй backend/.env.example в backend/.env перед первым деплоем." >&2
  exit 1
fi

echo "==> git pull"
git pull --ff-only

echo "==> docker compose up -d --build"
docker compose up -d --build

echo "==> статус контейнеров"
docker compose ps

echo "==> готово. Логи: docker compose logs -f"
