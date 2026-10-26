#!/usr/bin/env bash
# 更新部署：檢查環境 → git pull → （備份）→ 重建前端 → 重建／重啟後端並等健康檢查
#          → 檢查反向代理路由；任何一步在切換後失敗，自動回滾到上一版。
# 用法：bash deploy.sh          （沒有新 commit 就跳過）
#      bash deploy.sh --force   （強制重建，例如只改了 .env）
# 環境變數：
#      SKIP_BACKUP=1     略過部署前備份（不建議）
#      PROXY_BASE=...    反向代理對外位址，預設 https://127.0.0.1
#      ALLOW_NO_REDIS=1  .env 沒有 REDIS_URL 也照常部署（限流計數會退回各 worker 的記憶體）
#
# 請用一般使用者（不是 root）執行：容器會用這個使用者的 uid 跑，掛載的 logs／media 才不會有權限問題。
# 第一次改成非 root 容器之前，logs／media 若還是 root 擁有，先 sudo chown -R "$USER:$USER" logs media。
#
# 回滾範圍：前端 dist 與兩個後端 image（yuanyu-django／yuanyu-fastapi 的 :prev 標籤）。
# 不含資料庫 schema：後端容器啟動時會自動 migrate，若新版 migration 與舊版程式不相容，
# 切回舊 image 也救不了，這時要用部署前備份（deploy/backup.sh）還原。程式碼本身
# （git）不會自動回退，失敗時會印出上一版的 commit，要回去請手動 git reset／checkout。
#
# 上一版的保護：部署開始時建立 .deploy-in-progress，部署成功（或回滾成功）才移除。
# 若上一次部署被中斷（斷線、斷電、被 kill）而留下這個檔案，這次部署不會重新拍攝回滾點
# （此時 :latest 與 dist 可能是未驗證的半成品），沿用上次留下的 dist.prev 與 :prev。
set -euo pipefail
cd "$(dirname "$0")"

# shellcheck source=deploy/env.sh
. deploy/env.sh

FORCE="${1:-}"
COMPOSE=(docker compose -f docker-compose.prod.yml)
# 容器的執行身分（docker-compose.prod.yml 的 user:）。取部署者的 uid，掛載目錄才寫得進去。
export APP_UID APP_GID
APP_UID="$(id -u)"
APP_GID="$(id -g)"
IMAGES=(yuanyu-django yuanyu-fastapi)
PROXY_BASE="${PROXY_BASE:-https://127.0.0.1}"
MARKER=.deploy-in-progress

# ── 0. 正式環境防呆 ──────────────────────────────────────────────
# DEBUG 與 AUTH_DEV_BYPASS 同時為 True 時，後端會略過 Firebase token 驗證（見
# backend/config/auth_flags.py），整個站台等於沒有登入。這份 .env 若是從開發機複製
# 過來，部署前就擋下來。
preflight() {
  if [ "$(id -u)" = "0" ]; then
    echo "!! 請用一般使用者執行，不要用 root：容器會用執行者的 uid 跑，root 會讓容器退回以 root 執行。部署中止。"; return 1
  fi
  [ -f .env ] || { echo "!! 找不到 .env"; return 1; }
  [ -f serviceAccountKey.json ] || { echo "!! 找不到 serviceAccountKey.json"; return 1; }
  if is_true "$(env_value DJANGO_DEBUG)"; then
    echo "!! .env 的 DJANGO_DEBUG 是 True，正式環境必須關閉。部署中止。"; return 1
  fi
  if is_true "$(env_value AUTH_DEV_BYPASS)"; then
    echo "!! .env 的 AUTH_DEV_BYPASS 是 True，會略過登入驗證。部署中止。"; return 1
  fi
  if [ -z "$(env_value DATABASE_URL)" ]; then
    echo "!! .env 沒有 DATABASE_URL，會退回不持久的 SQLite。部署中止。"; return 1
  fi
  if [ -z "$(env_value DJANGO_SECRET_KEY)" ]; then
    echo "!! .env 沒有 DJANGO_SECRET_KEY。部署中止。"; return 1
  fi
  # 沒有 REDIS_URL 時限流計數只存在各 worker 的記憶體：gunicorn 3 個 worker 的門檻變 3 倍，重啟還會歸零。
  # 確定要這樣部署時用 ALLOW_NO_REDIS=1 明確放行。
  if [ -z "$(env_value REDIS_URL)" ] && ! is_true "${ALLOW_NO_REDIS:-}"; then
    echo "!! .env 沒有 REDIS_URL，限流計數會退回各 worker 的記憶體。請設定，或用 ALLOW_NO_REDIS=1 明確放行。部署中止。"; return 1
  fi
  # 等待健康檢查與回滾都依賴 `up --wait --wait-timeout`，太舊的 Docker Compose 不支援，
  # 部署到一半才失敗、連回滾也失敗最糟，所以先檢查。
  if ! "${COMPOSE[@]}" up --help 2>&1 | grep -q -- '--wait-timeout'; then
    echo "!! 這個版本的 Docker Compose 不支援 up --wait-timeout，請升級到 Compose v2.18 以上。部署中止。"; return 1
  fi
}

echo "==> 檢查 .env 與環境"
preflight

# 非阻擋警告：沒有設定 SENTRY_DSN 時，後端（Django 與 FastAPI 都已接上 Sentry）的錯誤不會送出，
# 部署後出問題只能翻 log 檔才知道。這不是部署的必要條件，所以只提醒、不中止。
if [ -z "$(env_value SENTRY_DSN)" ]; then
  echo "!! 警告：.env 沒有設定 SENTRY_DSN，後端錯誤不會送出告警。部署會繼續。"
fi

BEFORE=$(git rev-parse HEAD)
echo "==> 目前版本 $(git rev-parse --short HEAD)，拉取最新..."
git pull --ff-only
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ] && [ "$FORCE" != "--force" ]; then
  echo "==> 已是最新，無變更。要強制重建：bash deploy.sh --force"
  exit 0
fi

# pull 之後 .env 不會變，但 deploy.sh 本身可能剛被更新，這裡再檢查一次沒有壞處。
preflight

# ── 1. 部署前備份（要有可以還原的點，才能放心 migrate）─────────────
if [ "${SKIP_BACKUP:-}" != "1" ] && [ -f deploy/backup.sh ]; then
  echo "==> 部署前備份"
  bash deploy/backup.sh || { echo "!! 備份失敗，部署中止（確定要略過請用 SKIP_BACKUP=1）"; exit 1; }
fi

# ── 1.5 準備可寫的目錄 ──────────────────────────────────────────
# 容器以部署者的 uid 執行，掛載進去的 logs／media 必須先存在且屬於這個 uid：不存在的話 Docker 會
# 自己以 root 建立，容器就寫不進去。舊版（容器是 root）留下的 root 擁有檔案也在這裡一併修正；
# 放在拍攝回滾點之前，dist.prev 才不會繼承 root 擁有者而在最後清不掉。
# 只處理實際會被寫入的目錄，不遞迴改整個 repo（.git、金鑰檔的擁有者不該被動到）。
echo "==> 準備 logs／media 目錄"
mkdir -p logs media
for d in logs media dist dist.prev node_modules; do
  if [ -e "$d" ]; then sudo chown -R "$APP_UID:$APP_GID" "$d"; fi
done

# ── 2. 留下回滾點 ───────────────────────────────────────────────
if [ -f "$MARKER" ]; then
  echo "!! 偵測到上一次部署沒有完成（$MARKER 還在）。"
  echo "   這次不重新拍攝回滾點，沿用上次留下的 dist.prev 與 :prev（它們才是最後一個確認健康的版本）。"
else
  rm -rf dist.prev
  [ -d dist ] && cp -a dist dist.prev
  for img in "${IMAGES[@]}"; do
    if docker image inspect "$img:latest" >/dev/null 2>&1; then
      docker tag "$img:latest" "$img:prev"
    fi
  done
fi
touch "$MARKER"

rollback() {
  trap - ERR
  set +e
  local ok=1
  echo "!! 部署失敗，回滾到上一版..."

  if [ -d dist.prev ]; then
    rm -rf dist && mv dist.prev dist || { echo "!! 前端還原失敗"; ok=0; }
  else
    echo "!! 沒有 dist.prev，前端維持目前狀態"
  fi

  # 兩個 image 都有 :prev 才回滾，避免只標回其中一個而形成 Django／FastAPI 新舊混合
  local have_prev=1 img
  for img in "${IMAGES[@]}"; do
    docker image inspect "$img:prev" >/dev/null 2>&1 || have_prev=0
  done
  if [ "$have_prev" = "1" ]; then
    for img in "${IMAGES[@]}"; do
      docker tag "$img:prev" "$img:latest" || { echo "!! 標回上一版 image 失敗：$img"; ok=0; }
    done
    if [ "$ok" = "1" ]; then
      "${COMPOSE[@]}" up -d --no-build --force-recreate --wait --wait-timeout 300 \
        || { echo "!! 上一版沒有通過健康檢查，請手動檢查：docker compose -f docker-compose.prod.yml logs"; ok=0; }
    fi
  else
    echo "!! 沒有完整的上一版 image（第一次部署？），無法自動回滾容器。"
    ok=0
  fi

  if [ "$ok" = "1" ]; then
    rm -f "$MARKER"
    echo "!! 已回到上一版的前端與容器。程式碼仍在新 commit $(git rev-parse --short HEAD)；"
    echo "   要讓 git 也回去：git reset --hard $BEFORE"
  else
    echo "!! 回滾沒有完全成功，目前可能是新舊版本混合。請手動檢查，並保留 dist.prev 與 :prev 標籤，不要再次部署。"
  fi
  exit 1
}

# 切換之後的任何失敗都走 rollback（set -e 觸發 ERR trap）
trap rollback ERR

# ── 3. 重建前端 ─────────────────────────────────────────────────
echo "==> 重建前端"
# 用部署者的 uid 跑，產出的 node_modules、dist 才不會是 root 擁有；HOME 指到可寫的暫存目錄給 npm 用
docker run --rm --user "$APP_UID:$APP_GID" -e HOME=/tmp -v "$PWD":/app -w /app node:20-slim sh -c "npm ci && npm run build"

# ── 4. 重建並重啟後端，等到兩個服務都通過健康檢查 ──────────────────
echo "==> 重建後端 image"
"${COMPOSE[@]}" build

echo "==> 重啟後端容器並等待健康檢查（django: /health/、fastapi: /ready）"
"${COMPOSE[@]}" up -d --wait --wait-timeout 420

# 到這裡新版容器已通過健康檢查，這次部署對回滾而言算成功：移除標記與舊的 dist 備份
trap - ERR
rm -f "$MARKER"
rm -rf dist.prev

# ── 5. 反向代理路由冒煙檢查 ─────────────────────────────────────
# 到這裡容器都已經通過健康檢查，新版後端是好的；代理設定有問題時回滾容器沒有幫助，
# 所以這一段只回報、不回滾。
# 容器健康不代表使用者看得到：代理沒有轉發 /AIModel、/api/v1 時，前端會只有部分功能
# 404。這裡用「不帶 token 會被擋下的端點」確認請求真的到了後端——後端回 401／400／
# 403／405 代表有轉到；404／502／連不上代表代理設定有問題。
PROXY_OK=1

check_route() {
  local method="$1" path="$2" code
  code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 -X "$method" "$PROXY_BASE$path" || true)
  case "$code" in
    400|401|403|405|422) echo "   OK   $method $path -> $code" ;;
    *) echo "   FAIL $method $path -> $code（預期 400/401/403/405/422，代表請求有轉到後端）"; PROXY_OK=0 ;;
  esac
}

# 後端只准 nginx 連：Django 信任 X-Forwarded-Proto（settings.py 的 SECURE_PROXY_SSL_HEADER），
# 能直接連到後端埠口的人可以自己宣稱「這是 HTTPS」、偽造來源 IP，繞過 nginx 的限流與標頭。
# docker-compose.prod.yml 綁 127.0.0.1；這裡確認實際監聽的位址真的只有本機。
check_loopback_only() {
  local port="$1" addrs bad
  # 驗證不了就算失敗：「後端只對本機開放」是部署的安全前提，不能在沒檢查到的情況下默默放行。
  if ! command -v ss >/dev/null 2>&1; then echo "   FAIL 找不到 ss 指令，無法確認後端埠口 $port 只對本機開放（安裝 iproute2，或手動確認後以 SKIP_PORT_CHECK=1 略過）"; [ "${SKIP_PORT_CHECK:-0}" = "1" ] || PROXY_OK=0; return; fi
  if ! addrs=$(ss -ltnH "sport = :$port" 2>/dev/null | awk '{print $4}'); then addrs=""; fi
  if [ -z "$addrs" ]; then echo "   FAIL ss 沒有列出埠口 $port 的監聽（服務沒起來，或 ss 不支援這個用法）"; [ "${SKIP_PORT_CHECK:-0}" = "1" ] || PROXY_OK=0; return; fi
  bad=$(printf '%s\n' "$addrs" | grep -vE '^(127\.0\.0\.1|\[::1\]|::1):' || true)
  if [ -z "$bad" ]; then echo "   OK   後端埠口 $port 只對本機開放"
  else echo "   FAIL 後端埠口 $port 對外開放：$(echo $bad)（應只綁 127.0.0.1）"; PROXY_OK=0; fi
}

# 回應標頭不洩漏後端與 nginx 的名稱、版本（gunicorn／uvicorn／nginx/1.x.x）
check_server_header() {
  local value
  value=$(curl -skI --max-time 15 "$PROXY_BASE/health/" 2>/dev/null | tr -d '\r' | awk -F': *' 'tolower($1)=="server"{print $2}') || true
  case "$value" in
    *gunicorn*|*uvicorn*|*[0-9].[0-9]*) echo "   FAIL Server 標頭洩漏版本資訊：$value"; PROXY_OK=0 ;;
    *) echo "   OK   Server 標頭未洩漏版本資訊${value:+（$value）}" ;;
  esac
}

echo "==> 檢查反向代理（$PROXY_BASE）"
if curl -fsk --max-time 15 -o /dev/null "$PROXY_BASE/"; then echo "   OK   GET /"; else echo "   FAIL GET /（SPA 靜態檔沒有提供？）"; PROXY_OK=0; fi
if curl -fsk --max-time 15 -o /dev/null "$PROXY_BASE/health/"; then echo "   OK   GET /health/"; else echo "   FAIL GET /health/（沒有轉到 Django？）"; PROXY_OK=0; fi
check_route POST /AIModel/tayal_chat/
check_route POST /api/v1/translation/translate
check_loopback_only 8000
check_loopback_only 8001
check_server_header

echo "==> 狀態"
"${COMPOSE[@]}" ps
docker image prune -f >/dev/null

if [ "$PROXY_OK" != "1" ]; then
  echo "!! 後端容器已更新且健康，但反向代理檢查未通過。請對照 deploy/nginx.conf 檢查伺服器上的代理設定。"
  exit 1
fi
echo "==> 完成（版本 $(git rev-parse --short HEAD)）"
