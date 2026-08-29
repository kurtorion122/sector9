#!/usr/bin/env bash
# СЕКТОР-9 — установка сервера на Ubuntu/Debian (закрытая сеть, без интернета).
# Запуск из распакованной папки sector9-server:  sudo bash setup.sh
set -euo pipefail

APP_DIR=/opt/sector9
SERVICE=sector9

if [ "$(id -u)" -ne 0 ]; then
  echo "  ОШИБКА: запустите с правами root:  sudo bash setup.sh" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "  ОШИБКА: Node.js не найден в PATH." >&2
  echo "  Установите его из архива (см. инструкцию) и повторите запуск." >&2
  exit 1
fi

echo "  Node.js: $(node -v)"

mkdir -p "$APP_DIR"
cp -r dist serve.cjs node_modules "$APP_DIR/"
cp sector9.service /etc/systemd/system/$SERVICE.service

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"
sleep 1

if systemctl is-active --quiet "$SERVICE"; then
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo ""
  echo "  ==========================================="
  echo "   СЕКТОР-9 запущен и добавлен в автозагрузку"
  echo "  ==========================================="
  echo "   Игра на этом сервере:  http://${IP:-localhost}:3000"
  echo "   Для клиентов сети:     http://10.21.1.45:3000"
  echo ""
  echo "   Логи:      journalctl -u $SERVICE -f"
  echo "   Перезапуск: sudo systemctl restart $SERVICE"
  echo "   Остановка:  sudo systemctl stop $SERVICE"
  echo ""
else
  echo "  ОШИБКА: сервис не запустился. Смотрите: journalctl -u $SERVICE -n 40 --no-pager" >&2
  exit 1
fi
