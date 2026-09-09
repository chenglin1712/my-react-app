#!/usr/bin/env bash
# 更新部署：git pull → 重建前端 → 重建/重啟後端 → 檢查
# 用法：bash deploy.sh          （沒有新 commit 就跳過）
#      bash deploy.sh --force   （強制重建，例如只改了 .env）
set -euo pipefail
cd "$(dirname "$0")"

FORCE="${1:-}"
BEFORE=$(git rev-parse HEAD)
echo "==> 目前版本 $(git rev-parse --short HEAD)，拉取最新..."
git pull --ff-only
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ] && [ "$FORCE" != "--force" ]; then
  echo "==> 已是最新，無變更。要強制重建：bash deploy.sh --force"
  exit 0
fi

echo "==> 重建前端"
docker run --rm -v "$PWD":/app -w /app node:20-slim sh -c "npm ci && npm run build"

echo "==> 重建並重啟後端容器"
docker compose -f docker-compose.prod.yml up -d --build

echo "==> 修正擁有者 + 清理舊 image"
sudo chown -R "$USER:$USER" .
docker image prune -f >/dev/null

echo "==> 狀態"
docker compose -f docker-compose.prod.yml ps
echo -n "health: "; curl -sk https://127.0.0.1/health/ ; echo
echo "==> 完成（版本 $(git rev-parse --short HEAD)）"
