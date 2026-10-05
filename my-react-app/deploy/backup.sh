#!/usr/bin/env bash
# 備份：PostgreSQL（Django 資料庫與辭典資料庫）；選擇性備份 Firestore 與 Storage。
# 用法：bash deploy/backup.sh            （deploy.sh 在部署前會自動呼叫）
# 環境變數（皆可選）：
#   BACKUP_DIR=./backups                 備份存放目錄
#   RETENTION_DAYS=14                    保留天數，更舊的備份會被刪除
#   FIRESTORE_BACKUP_BUCKET=gs://xxx     設定後才會呼叫 gcloud 匯出 Firestore
#   STORAGE_BACKUP_BUCKET=gs://xxx       設定後才會把 Firebase Storage 同步到這個 bucket
#   STORAGE_SOURCE_BUCKET=gs://xxx       上面那個要同步的來源（Firebase Storage bucket）
#
# 還原步驟與演練清單見 deploy/README.md。備份沒有實際還原成功過，就不算有備份。
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

env_value() {
  local v
  v=$(grep -E "^[[:space:]]*$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//; s/^["'\'']//; s/["'\'']$//' || true)
  printf '%s' "$v"
}

# 用本機 pg_dump；沒有的話借用 postgres 官方 image 裡的（--network host 才連得到本機的資料庫）。
# 注意 pg_dump 主版本不可低於伺服器版本，必要時調整下面的 image 版本。
run_pg() {
  if command -v "$1" >/dev/null 2>&1; then
    "$@"
  elif command -v docker >/dev/null 2>&1; then
    docker run --rm -i --network host postgres:16-alpine "$@"
  else
    echo "!! 找不到 $1，也沒有 docker 可借用" >&2
    return 1
  fi
}

dump_one() {
  local name="$1" url="$2"
  local out="$BACKUP_DIR/$name-$STAMP.dump"
  # 連線字串用 postgres:// 開頭時 pg_dump 也吃，不需要正規化
  run_pg pg_dump --format=custom --no-owner --dbname="$url" > "$out"
  [ -s "$out" ] || { echo "!! $name 備份檔是空的" >&2; rm -f "$out"; return 1; }
  # 確認備份檔本身可讀（目錄表能列出來），不是只有「檔案存在」
  if ! run_pg pg_restore --list < "$out" >/dev/null 2>&1; then
    echo "!! $name 備份檔無法被 pg_restore 讀取，可能已損毀，已刪除這份檔案" >&2
    rm -f "$out"
    return 1
  fi
  echo "   OK   $name -> $out ($(du -h "$out" | cut -f1))"
}

DB_URL="$(env_value DATABASE_URL)"
DICT_URL="$(env_value DICTIONARY_DATABASE_URL)"
[ -n "$DB_URL" ] || { echo "!! .env 沒有 DATABASE_URL，沒有東西可備份" >&2; exit 1; }

echo "==> PostgreSQL 備份"
dump_one django "$DB_URL"
# 辭典資料庫與 Django 共用同一個資料庫時不重複備份
if [ -n "$DICT_URL" ] && [ "$DICT_URL" != "$DB_URL" ]; then
  dump_one dictionary "$DICT_URL"
fi

if [ -n "${FIRESTORE_BACKUP_BUCKET:-}" ]; then
  echo "==> Firestore 匯出 -> $FIRESTORE_BACKUP_BUCKET/firestore/$STAMP"
  command -v gcloud >/dev/null 2>&1 || { echo "!! 找不到 gcloud" >&2; exit 1; }
  gcloud firestore export "$FIRESTORE_BACKUP_BUCKET/firestore/$STAMP"
else
  echo "==> 略過 Firestore（未設定 FIRESTORE_BACKUP_BUCKET；Firestore 與 Firebase Auth 目前沒有被備份）"
fi

if [ -n "${STORAGE_BACKUP_BUCKET:-}" ] && [ -n "${STORAGE_SOURCE_BUCKET:-}" ]; then
  echo "==> Storage 同步 $STORAGE_SOURCE_BUCKET -> $STORAGE_BACKUP_BUCKET/storage"
  command -v gsutil >/dev/null 2>&1 || { echo "!! 找不到 gsutil" >&2; exit 1; }
  gsutil -m rsync -r "$STORAGE_SOURCE_BUCKET" "$STORAGE_BACKUP_BUCKET/storage"
else
  echo "==> 略過 Storage（未設定 STORAGE_BACKUP_BUCKET 與 STORAGE_SOURCE_BUCKET）"
fi

echo "==> 清理 $RETENTION_DAYS 天前的舊備份"
find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' -type f -mtime +"$RETENTION_DAYS" -print -delete

echo "==> 備份完成 ($STAMP)"
