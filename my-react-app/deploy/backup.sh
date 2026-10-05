#!/usr/bin/env bash
# 備份：PostgreSQL（Django 資料庫與辭典資料庫）；選擇性備份 Firestore 與 Storage。
# 用法：bash deploy/backup.sh            （deploy.sh 在部署前會自動呼叫）
# 需要：python3（用來拆解資料庫連線字串，見下方說明）
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

# shellcheck source=deploy/env.sh
. deploy/env.sh

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# 不能只用 command -v：Windows 的 Microsoft Store 捷徑（python3.exe）找得到但執行會失敗，
# 所以挑第一個「真的能執行」的。
PYTHON=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c "import sys" >/dev/null 2>&1; then
    PYTHON="$candidate"
    break
  fi
done

# 把連線字串拆成 libpq 的環境變數（PGHOST／PGPORT／PGUSER／PGPASSWORD／PGDATABASE／PGSSLMODE）。
# 原本把整串 URL（含密碼）放在 `pg_dump --dbname=...` 的命令列參數上，備份執行期間同一台機器上
# 能看 process 清單的帳號或監控程式都看得到資料庫密碼。環境變數不會出現在命令列：
# URL 本身用環境變數傳給 python（不放在參數上），輸出的 export 敘述只經過 eval，不會成為任何
# 指令的參數。URL 中的使用者名稱與密碼若有特殊字元，需以 URI 百分比編碼（例如 @ 寫成 %40）。
pg_env_exports() {
  [ -n "$PYTHON" ] || { echo "!! 找不到 python3，無法拆解資料庫連線字串" >&2; return 1; }
  PG_URL="$1" "$PYTHON" -c '
import os, shlex
from urllib.parse import urlparse, unquote, parse_qs
u = urlparse(os.environ["PG_URL"])
q = parse_qs(u.query)
values = {
    "PGHOST": u.hostname,
    "PGPORT": str(u.port) if u.port else None,
    "PGUSER": unquote(u.username) if u.username else None,
    "PGPASSWORD": unquote(u.password) if u.password else None,
    "PGDATABASE": unquote(u.path.lstrip("/")),
    "PGSSLMODE": (q.get("sslmode") or [None])[0],
}
for key, value in values.items():
    if value:
        print("export %s=%s" % (key, shlex.quote(value)))
'
}

# 用本機 pg_dump；沒有的話借用 postgres 官方 image 裡的。docker 只傳「變數名稱」(-e NAME)，
# 值由目前的環境變數帶入，同樣不會出現在命令列。--network host 只在 Linux 有效，正式環境
# 本來就是 Linux 單機（見 docker-compose.prod.yml）。pg_dump 主版本不可低於伺服器版本，
# 必要時調整下面的 image 版本。
run_pg() {
  if command -v "$1" >/dev/null 2>&1; then
    "$@"
  elif command -v docker >/dev/null 2>&1; then
    docker run --rm -i --network host \
      -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE \
      postgres:16-alpine "$@"
  else
    echo "!! 找不到 $1，也沒有 docker 可借用" >&2
    return 1
  fi
}

dump_one() {
  local name="$1" url="$2"
  local out="$BACKUP_DIR/$name-$STAMP.dump"
  # 子 shell：連線用的環境變數只在這次 pg_dump 期間存在，不會殘留到後面的指令
  if ! (
    # 先取得 export 敘述再 eval：`eval "$(失敗的指令)"` 會得到空字串而「成功」，
    # 這時 pg_dump 會在沒有連線資訊下連到本機預設資料庫，備份到錯誤的東西。
    pg_exports="$(pg_env_exports "$url")" || exit 1
    eval "$pg_exports"
    export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE
    run_pg pg_dump --format=custom --no-owner > "$out"
  ); then
    echo "!! $name 備份失敗" >&2
    rm -f "$out"
    return 1
  fi
  [ -s "$out" ] || { echo "!! $name 備份檔是空的" >&2; rm -f "$out"; return 1; }
  # 確認備份檔本身可讀（目錄表能列出來），不是只有「檔案存在」。pg_restore --list 只讀檔案，不連線。
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
