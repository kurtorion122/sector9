#!/usr/bin/env bash
# СЕКТОР-9 — сборка автономного серверного дистрибутива для закрытой сети.
# Запуск из корня проекта:  bash deploy/pack.sh
# Результат: sector9-server.tar.gz (игра + микросервер + зависимость ws + systemd-юнит)
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f dist/index.html ]; then
  echo "  ОШИБКА: папка dist/ не найдена. Сначала выполните: npm run build" >&2
  exit 1
fi
if [ ! -d node_modules/ws ]; then
  echo "  ОШИБКА: node_modules/ws не найден. Сначала выполните: npm install" >&2
  exit 1
fi

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/sector9-server/node_modules"

cp -r dist "$STAGE/sector9-server/dist"
cp serve.cjs "$STAGE/sector9-server/serve.cjs"
cp -r node_modules/ws "$STAGE/sector9-server/node_modules/ws"
cp deploy/sector9.service "$STAGE/sector9-server/sector9.service"
cp deploy/setup.sh "$STAGE/sector9-server/setup.sh"

OUT="$(pwd)/sector9-server.tar.gz"
tar -czf "$OUT" -C "$STAGE" sector9-server
echo ""
echo "  Готово: $OUT  ($(du -h "$OUT" | cut -f1))"
echo "  Перенесите архив на сервер закрытой сети и распакуйте:"
echo "    tar -xzf sector9-server.tar.gz && cd sector9-server && sudo bash setup.sh"
echo ""
