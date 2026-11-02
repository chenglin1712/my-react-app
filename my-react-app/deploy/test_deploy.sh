#!/usr/bin/env bash
# deploy.sh、deploy/backup.sh 與 deploy/env.sh 的行為測試。
#
# 在暫存目錄用「假的」docker／git／curl／pg_dump 執行真正的腳本，驗證各條路徑：
# 成功、健康檢查失敗自動回滾、回滾失敗要誠實回報、中斷後不覆蓋真正的上一版、.env 防呆
# （含 CRLF、export 前綴、引號）、備份失敗中止、反向代理檢查失敗只報錯不回滾、備份檔檢查、
# 資料庫密碼不出現在命令列、舊備份清理。不需要 docker 或資料庫，CI 與本機都能跑。
# 用法：bash deploy/test_deploy.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
PASS=0
FAIL=0

mkdir -p "$SB/bin" "$SB/state" "$SB/repo/deploy"
cp "$ROOT/deploy.sh" "$SB/repo/deploy.sh"
cp "$ROOT/deploy/backup.sh" "$ROOT/deploy/env.sh" "$SB/repo/deploy/"
for f in package.json package-lock.json vite.config.js index.html firebase.js jsconfig.json; do echo "// $f" > "$SB/repo/$f"; done
mkdir -p "$SB/repo/frontend" "$SB/repo/public"; echo "// app" > "$SB/repo/frontend/main.jsx"; echo "{}" > "$SB/repo/public/sw.js"

# ── 假的外部指令 ─────────────────────────────────────────────────
cat > "$SB/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$SB_LOG"
if [ "$1 $2" = "image inspect" ]; then exit 0; fi
# 回滾時把 :prev 標回 :latest 的指令（來源名稱以 :prev 結尾）
if [ "$1" = "tag" ] && [ "${FAIL_TAG:-0}" = "1" ]; then
  case "$2" in *:prev) exit 1 ;; esac
fi
if [ "$1" = "compose" ]; then
  case "$*" in
    *"up --help"*) echo "      --wait-timeout int   Maximum duration to wait for the project to be running|healthy"; exit 0 ;;
    *"up -d --wait"*)
      echo "compose-env APP_UID=${APP_UID:-} APP_GID=${APP_GID:-}" >> "$SB_LOG"
      if [ "${FAIL_UP:-0}" = "1" ] && [ ! -f "$SB_STATE/up_failed" ]; then touch "$SB_STATE/up_failed"; exit 1; fi ;;
  esac
fi
if [ "$1" = "run" ]; then
  mount=""; prev=""
  for a in "$@"; do [ "$prev" = "-v" ] && mount="${a%%:*}"; prev="$a"; done
  echo "build-mount $mount" >> "$SB_LOG"
  ( cd "$mount" && ls -A | sed 's/^/build-file /' >> "$SB_LOG"; [ -f .env.production ] && sed 's/^/build-env /' .env.production >> "$SB_LOG" )
  [ "${FAIL_BUILD:-0}" = "1" ] && exit 1
  mkdir -p "$mount/dist" && echo new > "$mount/dist/index.html"
fi
exit 0
EOF
cat > "$SB/bin/git" <<'EOF'
#!/usr/bin/env bash
GIT_C=""
while [ "$1" = "-c" ]; do GIT_C="$GIT_C -c $2"; shift 2; done
case "$1" in
  rev-parse) if [ "$2" = "--short" ]; then echo abc1234
             elif [ "$2" = "--verify" ]; then echo cccc   # tag 物件與它指向的 commit（簽署的 commit 是 cccc）
             elif [ -s "$SB_STATE/pulled" ]; then cat "$SB_STATE/pulled"
             elif [ -f "$SB_STATE/pulled" ]; then echo bbbb; else echo aaaa; fi ;;
  pull) echo "git pull" >> "$SB_LOG"; touch "$SB_STATE/pulled" ;;
  fetch) echo "git fetch ${*:2}" >> "$SB_LOG" ;;
  diff) if [ "${DIRTY:-0}" = "1" ]; then exit 1; fi ;;
  verify-tag) echo "git$GIT_C verify-tag ${*:2}" >> "$SB_LOG"; if [ "${BAD_SIG:-0}" = "1" ]; then exit 1; fi ;;
  merge) echo "git merge ${*:2}" >> "$SB_LOG"; echo cccc > "$SB_STATE/pulled" ;;
  merge-base) if [ "${NOT_ANCESTOR:-0}" = "1" ]; then exit 1; fi ;;
  archive) shift; while [ "$1" != "--" ]; do shift; done; shift; tar -cf - "$@" ;;
esac
EOF
cat > "$SB/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> "$SB_LOG"
case "$*" in *"-w %{http_code}"*) printf '%s' "${ROUTE_CODE:-401}" ;; esac
case "$*" in *-skI*) printf 'HTTP/2 200\r\nserver: %s\r\n' "${SERVER_HEADER:-nginx}" ;; esac
exit "${CURL_RC:-0}"
EOF
# 假的 ss：回報後端埠口的監聽位址。LISTEN_ADDR 預設只綁本機；可用空白分隔多個位址（模擬同一埠多個監聽）；
# 設成 0.0.0.0 模擬對外開放，none 模擬沒有輸出，fail 模擬 ss 執行失敗
cat > "$SB/bin/ss" <<'EOF'
#!/usr/bin/env bash
[ "${LISTEN_ADDR:-127.0.0.1}" = "fail" ] && exit 1
[ "${LISTEN_ADDR:-127.0.0.1}" = "none" ] && exit 0
port="${*##*:}"
for addr in ${LISTEN_ADDR:-127.0.0.1}; do echo "LISTEN 0 511 $addr:$port 0.0.0.0:*"; done
EOF
# 假的 pg_dump：記下「命令列參數」與「連線用的環境變數」，用來證明密碼只走環境變數
cat > "$SB/bin/pg_dump" <<'EOF'
#!/usr/bin/env bash
echo "pg_dump ARGS: $*" >> "$SB_LOG"
echo "pg_dump ENV: PGHOST=${PGHOST:-} PGPORT=${PGPORT:-} PGUSER=${PGUSER:-} PGPASSWORD=${PGPASSWORD:-} PGDATABASE=${PGDATABASE:-} PGSSLMODE=${PGSSLMODE:-}" >> "$SB_LOG"
[ "${DUMP_EMPTY:-0}" = "1" ] && exit 0
echo "FAKE-DUMP-DATA"
EOF
cat > "$SB/bin/pg_restore" <<'EOF'
#!/usr/bin/env bash
cat > /dev/null
[ "${RESTORE_FAIL:-0}" = "1" ] && exit 1
echo "TOC"
EOF
printf '#!/usr/bin/env bash\necho "sudo $*" >> "$SB_LOG"\nexit 0\n' > "$SB/bin/sudo"
# 假的 id：讓測試不受執行者身分影響（FAKE_UID=0 模擬用 root 執行）
cat > "$SB/bin/id" <<'EOF'
#!/usr/bin/env bash
case "$1" in -u) echo "${FAKE_UID:-1234}" ;; -g) echo "${FAKE_GID:-5678}" ;; *) /usr/bin/id "$@" ;; esac
EOF
chmod +x "$SB/bin/"*

# ── 工具函式 ─────────────────────────────────────────────────────
good_env() {
  printf 'DJANGO_SECRET_KEY=x\nDJANGO_DEBUG=False\nAUTH_DEV_BYPASS=False\nDATABASE_URL=postgresql://u:p@h/db\nREDIS_URL=redis://localhost:6379/0\nALLOWED_ORIGINS=https://app.example\nCSRF_TRUSTED_ORIGINS=https://app.example\nAI_MONTHLY_BUDGET_USD=50\n' > "$SB/repo/.env"
  echo '{}' > "$SB/repo/serviceAccountKey.json"
}

# run_script <腳本> [環境變數=值 ...]：結果寫到 $SB/out，回傳腳本的結束碼
run_script() {
  local script="$1"; shift
  : > "$SB/log"; rm -rf "$SB/state"/*
  ( cd "$SB/repo" && env PATH="$SB/bin:$PATH" SB_LOG="$SB/log" SB_STATE="$SB/state" USER=tester ALLOW_UNSIGNED=1 "$@" bash "$script" --force ) > "$SB/out" 2>&1
}

fresh_dist() {
  rm -rf "$SB/repo/dist" "$SB/repo/dist.prev" "$SB/repo/.deploy-in-progress"
  mkdir -p "$SB/repo/dist"; echo old > "$SB/repo/dist/index.html"
}

check() { # 名稱 條件結果(0=通過)
  if [ "$2" = "0" ]; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1"; sed 's/^/       | /' "$SB/out" | tail -8; fi
}
out_has() { grep -q -- "$1" "$SB/out"; }
log_has() { grep -q -- "$1" "$SB/log"; }
dist_is() { [ "$(cat "$SB/repo/dist/index.html")" = "$1" ]; }

# ── deploy.sh ───────────────────────────────────────────────────
echo "deploy.sh"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "成功路徑：結束碼 0、dist 換成新版、回滾點與標記都已清掉" \
  "$([ $rc = 0 ] && dist_is new && [ ! -d "$SB/repo/dist.prev" ] && [ ! -f "$SB/repo/.deploy-in-progress" ]; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1 FAIL_UP=1; rc=$?
check "健康檢查失敗：結束碼非 0、自動回滾（dist 還原、:prev 標回 :latest、標記清掉）" \
  "$([ $rc != 0 ] && dist_is old && log_has "docker tag yuanyu-django:prev yuanyu-django:latest" && out_has '已回到上一版' && [ ! -f "$SB/repo/.deploy-in-progress" ]; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1 FAIL_UP=1 FAIL_TAG=1; rc=$?
check "回滾本身失敗：誠實回報，不可宣稱已回到上一版，且保留標記" \
  "$([ $rc != 0 ] && out_has '回滾沒有完全成功' && ! out_has '已回到上一版' && [ -f "$SB/repo/.deploy-in-progress" ]; echo $?)"

good_env; fresh_dist; mkdir -p "$SB/repo/dist.prev"; echo lkg > "$SB/repo/dist.prev/index.html"; echo halfnew > "$SB/repo/dist/index.html"; touch "$SB/repo/.deploy-in-progress"
run_script deploy.sh SKIP_BACKUP=1 FAIL_UP=1; rc=$?
check "上次部署被中斷（標記還在）：不重新拍攝回滾點，回滾到真正的上一版而不是半成品" \
  "$([ $rc != 0 ] && out_has '沿用上次留下的' && dist_is lkg && ! log_has 'docker tag yuanyu-django:latest yuanyu-django:prev'; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1 ROUTE_CODE=404; rc=$?
check "代理路由 404：結束碼非 0，但不回滾（容器與 dist 維持新版）" \
  "$([ $rc != 0 ] && out_has '反向代理檢查未通過' && dist_is new && ! log_has 'docker tag yuanyu-django:prev'; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1 CURL_RC=7 ROUTE_CODE=000; rc=$?
check "代理連不上：結束碼非 0" "$([ $rc != 0 ] && out_has 'FAIL'; echo $?)"

good_env; printf '#!/usr/bin/env bash\nexit 1\n' > "$SB/repo/deploy/backup.sh"; fresh_dist; run_script deploy.sh; rc=$?
check "備份失敗：中止，且沒有進入建置" "$([ $rc != 0 ] && out_has '備份失敗' && ! log_has 'compose.* build'; echo $?)"
cp "$ROOT/deploy/backup.sh" "$SB/repo/deploy/backup.sh"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "沒有 SENTRY_DSN：只印警告，部署照常成功（非阻擋）" "$([ $rc = 0 ] && out_has 'SENTRY_DSN' && dist_is new; echo $?)"

good_env; printf 'SENTRY_DSN=https://example@o0.ingest.sentry.io/1
' >> "$SB/repo/.env"; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "有設定 SENTRY_DSN：不印警告" "$([ $rc = 0 ] && ! out_has 'SENTRY_DSN'; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "容器用部署者的 uid／gid 執行（APP_UID／APP_GID 傳給 compose）" \
  "$([ $rc = 0 ] && log_has 'compose-env APP_UID=1234 APP_GID=5678'; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1 FAKE_UID=0; rc=$?
check "用 root 執行：中止，不啟動 root 容器" "$([ $rc != 0 ] && out_has '不要用 root' && ! log_has '^docker compose.* build'; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "啟動前先建好 logs／media，且前端建置用部署者的 uid（不產生 root 擁有的檔案）" \
  "$([ $rc = 0 ] && [ -d "$SB/repo/logs" ] && [ -d "$SB/repo/media" ] && log_has 'docker run --rm --user 1234:5678'; echo $?)"
check "chown 只動 logs／media／dist／node_modules，並用數字 uid:gid" \
  "$(log_has 'sudo chown -R 1234:5678 logs' && log_has 'sudo chown -R 1234:5678 media' && log_has 'sudo chown -R 1234:5678 dist' && ! log_has 'sudo chown.* \.$'; echo $?)"
check "deploy.sh 不再遞迴 chown 整個 repo" "$(! grep -qE 'chown -R .*\" .$|chown -R .$USER' deploy.sh; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "後端埠口只綁本機時通過" "$([ $rc = 0 ] && out_has '後端埠口 8000 只對本機開放' && out_has '後端埠口 8001 只對本機開放'; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1 LISTEN_ADDR=0.0.0.0; rc=$?
check "後端埠口對外開放：報錯（只回報、不回滾容器）" \
  "$([ $rc != 0 ] && out_has '後端埠口 8000 對外開放' && out_has '後端埠口 8001 對外開放' && dist_is new; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1 LISTEN_ADDR=none; rc=$?
check "ss 沒有列出監聽：算失敗（驗證不了就不放行）" "$([ $rc != 0 ] && out_has 'FAIL ss 沒有列出埠口 8000'; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1 LISTEN_ADDR=fail; rc=$?
check "ss 執行失敗：算失敗" "$([ $rc != 0 ] && out_has 'FAIL ss 沒有列出埠口 8000'; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1 LISTEN_ADDR="127.0.0.1 0.0.0.0"; rc=$?
check "同一埠同時有本機與萬用位址：仍判定對外開放" "$([ $rc != 0 ] && out_has '後端埠口 8000 對外開放'; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1 LISTEN_ADDR="127.0.0.1 [::1] ::1"; rc=$?
check "IPv4／IPv6 loopback 的幾種寫法都算只對本機開放" "$([ $rc = 0 ] && out_has '後端埠口 8000 只對本機開放'; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1 LISTEN_ADDR=none SKIP_PORT_CHECK=1; rc=$?
check "明確設 SKIP_PORT_CHECK=1 才能略過無法驗證的情況" "$([ $rc = 0 ]; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1 SERVER_HEADER="gunicorn"; rc=$?
check "Server 標頭洩漏 gunicorn：報錯" "$([ $rc != 0 ] && out_has 'Server 標頭洩漏版本資訊：gunicorn'; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1 SERVER_HEADER="nginx/1.24.0"; rc=$?
check "Server 標頭洩漏 nginx 版本：報錯" "$([ $rc != 0 ] && out_has 'Server 標頭洩漏版本資訊：nginx/1.24.0'; echo $?)"

echo "deploy.sh：簽章驗證（稽核 SUP-6）"
# run_tag <tag> [環境變數=值 ...]：不帶 ALLOW_UNSIGNED、指定 tag 執行
run_tag() {
  local tag="$1"; shift
  : > "$SB/log"; rm -rf "$SB/state"/*
  ( cd "$SB/repo" && env -u ALLOW_UNSIGNED PATH="$SB/bin:$PATH" SB_LOG="$SB/log" SB_STATE="$SB/state" USER=tester "$@" bash deploy.sh "$tag" --force ) > "$SB/out" 2>&1
}
good_env; fresh_dist; run_tag v1 SKIP_BACKUP=1; rc=$?
check "簽章有效的 tag：驗證後快轉並部署成功" \
  "$([ $rc = 0 ] && log_has 'git fetch --force origin refs/tags/v1:refs/deploy-candidates/v1' && log_has 'gpg.minTrustLevel=fully verify-tag' && log_has 'git merge --ff-only' && ! log_has 'git pull' && dist_is new; echo $?)"

good_env; fresh_dist; run_tag v1 SKIP_BACKUP=1 BAD_SIG=1; rc=$?
check "簽章無效：中止，不合併、不建置" \
  "$([ $rc != 0 ] && out_has '沒有有效的簽章' && ! log_has 'git merge' && ! log_has '^docker run' && dist_is old; echo $?)"

good_env; fresh_dist; : > "$SB/log"; ( cd "$SB/repo" && env -u ALLOW_UNSIGNED PATH="$SB/bin:$PATH" SB_LOG="$SB/log" SB_STATE="$SB/state" USER=tester SKIP_BACKUP=1 bash deploy.sh --force ) > "$SB/out" 2>&1; rc=$?
check "沒指定 tag 也沒有 ALLOW_UNSIGNED：中止，不 git pull" \
  "$([ $rc != 0 ] && out_has '需要指定已簽署的 tag' && ! log_has 'git pull' && ! log_has '^docker run'; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "ALLOW_UNSIGNED=1：退回 git pull 並印出警告" \
  "$([ $rc = 0 ] && log_has 'git pull' && out_has 'ALLOW_UNSIGNED=1' && ! log_has 'git verify-tag'; echo $?)"

good_env; fresh_dist; run_tag 'v1;rm -rf x' SKIP_BACKUP=1; rc=$?
check "tag 名稱含特殊字元：拒絕，不呼叫 git" \
  "$([ $rc != 0 ] && out_has 'tag 名稱只能包含' && ! log_has 'git verify-tag' && ! log_has 'git fetch'; echo $?)"

good_env; fresh_dist; run_tag v1 SKIP_BACKUP=1 DIRTY=1; rc=$?
check "工作樹有未提交修改：簽章驗證前就中止，不合併、不建置" \
  "$([ $rc != 0 ] && out_has '未提交修改' && ! log_has 'git fetch' && ! log_has 'git merge' && ! log_has '^docker run'; echo $?)"

good_env; fresh_dist; run_tag v1 SKIP_BACKUP=1 NOT_ANCESTOR=1; rc=$?
check "tag 的 commit 不是目前版本的後代（降級／別的分支）：中止，不合併、不建置" \
  "$([ $rc != 0 ] && out_has '不是目前版本的後代' && ! log_has 'git merge' && ! log_has '^docker run'; echo $?)"

echo "deploy.sh：前端建置不接觸機密（稽核 SUP-3）"
good_env; printf 'VITE_API_URL=https://api.example\nSECRET_TOKEN=do-not-leak\nDJANGO_SECRET_KEY=x\n  VITE_INDENTED=no\n' >> "$SB/repo/.env"; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "建置目錄不含 .env、serviceAccountKey.json、後端程式" \
  "$([ $rc = 0 ] && ! log_has 'build-file .env$' && ! log_has 'build-file serviceAccountKey.json' && ! log_has 'build-file backend' && ! log_has 'build-file logs' && log_has 'build-file package.json' && log_has 'build-file frontend'; echo $?)"
check "只有 VITE_ 開頭的變數被帶進建置（當作 .env.production）" \
  "$(log_has 'build-env VITE_API_URL=https://api.example' && ! log_has 'build-env SECRET_TOKEN' && ! log_has 'build-env DJANGO_SECRET_KEY' && ! log_has 'build-env .*INDENTED'; echo $?)"
check "不再把整個專案目錄掛進建置容器" \
  "$(! log_has "docker run .*-v $SB/repo:/app"; echo $?)"
check "建置映像是釘了摘要的 node:24" \
  "$(log_has 'node:24-slim@sha256:'; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1 FAIL_BUILD=1; rc=$?
check "建置失敗：現有的 dist 完全不動" \
  "$([ $rc != 0 ] && dist_is old; echo $?)"

good_env; printf 'VITE_API_URL=https://api.example\r\nVITE_AUTH_DEV_BYPASS_ROLE=owner\r\nVITE_FIREBASE_PROJECT_ID=demo\r\n' >> "$SB/repo/.env"; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "CRLF 的 .env：帶進建置的 VITE_ 值不含 CR" \
  "$([ $rc = 0 ] && log_has 'build-env VITE_API_URL=https://api.example$' && ! grep -q "$(printf '\r')" "$SB/log"; echo $?)"
check "VITE_AUTH_DEV_BYPASS_ROLE 不帶進正式建置" \
  "$(! log_has 'build-env VITE_AUTH_DEV_BYPASS'; echo $?)"

if ln -s ../outside "$SB/repo/frontend/link" 2>/dev/null && [ -L "$SB/repo/frontend/link" ]; then
  good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
  check "frontend/ 裡有 symlink：前端建置中止，不啟動容器" \
    "$([ $rc != 0 ] && out_has 'symlink' && ! log_has '^docker run'; echo $?)"
  rm -f "$SB/repo/frontend/link"
fi

echo "deploy.sh：.env 防呆"
env_case() { # 名稱 內容(printf 格式) 預期輸出關鍵字
  good_env; printf "$2" > "$SB/repo/.env"; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
  check "$1" "$([ $rc != 0 ] && out_has "$3" && ! log_has '^docker run'; echo $?)"
}
env_case "DJANGO_DEBUG=True 中止" 'DJANGO_SECRET_KEY=x\nDJANGO_DEBUG=True\nDATABASE_URL=postgresql://u:p@h/db\n' 'DJANGO_DEBUG'
env_case "CRLF 換行的 DJANGO_DEBUG=True 仍能辨識並中止" 'DJANGO_SECRET_KEY=x\r\nDJANGO_DEBUG=True\r\nDATABASE_URL=postgresql://u:p@h/db\r\n' 'DJANGO_DEBUG'
env_case "export 前綴的 AUTH_DEV_BYPASS=True 仍能辨識並中止" 'DJANGO_SECRET_KEY=x\nexport AUTH_DEV_BYPASS=True\nDATABASE_URL=postgresql://u:p@h/db\n' 'AUTH_DEV_BYPASS'
env_case "等號兩邊有空白的 DJANGO_DEBUG = true 仍能辨識並中止" 'DJANGO_SECRET_KEY=x\nDJANGO_DEBUG = true\nDATABASE_URL=postgresql://u:p@h/db\n' 'DJANGO_DEBUG'
env_case "帶引號與行尾註解的 AUTH_DEV_BYPASS=\"True\" # 開發用 仍能辨識並中止" 'DJANGO_SECRET_KEY=x\nAUTH_DEV_BYPASS="True"  # 開發用\nDATABASE_URL=postgresql://u:p@h/db\n' 'AUTH_DEV_BYPASS'
env_case "缺少 DATABASE_URL 中止" 'DJANGO_SECRET_KEY=x\nDJANGO_DEBUG=False\n' 'DATABASE_URL'
good_env; printf 'DJANGO_SECRET_KEY=x\n# DJANGO_DEBUG=True\nDJANGO_DEBUG=False\nDATABASE_URL=postgresql://u:p@h/db\nREDIS_URL=redis://localhost:6379/0\nALLOWED_ORIGINS=https://app.example\nCSRF_TRUSTED_ORIGINS=https://app.example\nAI_MONTHLY_BUDGET_USD=50\n' > "$SB/repo/.env"; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "被註解掉的 DJANGO_DEBUG=True 不算數，不會誤擋（部署成功）" "$([ $rc = 0 ]; echo $?)"

env_case "缺少 REDIS_URL 中止（限流計數會退回各 worker 的記憶體）" 'DJANGO_SECRET_KEY=x\nDJANGO_DEBUG=False\nDATABASE_URL=postgresql://u:p@h/db\n' 'REDIS_URL'
env_case "REDIS_URL 只有空引號也算沒設定，中止" 'DJANGO_SECRET_KEY=x\nDJANGO_DEBUG=False\nDATABASE_URL=postgresql://u:p@h/db\nREDIS_URL=""  # 沒設\n' 'REDIS_URL'
good_env; printf 'DJANGO_SECRET_KEY=x\nDJANGO_DEBUG=False\nDATABASE_URL=postgresql://u:p@h/db\nALLOWED_ORIGINS=https://app.example\nCSRF_TRUSTED_ORIGINS=https://app.example\nAI_MONTHLY_BUDGET_USD=50\n' > "$SB/repo/.env"; fresh_dist; run_script deploy.sh SKIP_BACKUP=1 ALLOW_NO_REDIS=1; rc=$?
check "ALLOW_NO_REDIS=1 明確放行：沒有 REDIS_URL 也能部署" "$([ $rc = 0 ]; echo $?)"

# ── backup.sh ───────────────────────────────────────────────────
echo "deploy.sh：缺少環境變數時中止（稽核 DEP-5）"
# 把 .env 的某個變數換成指定的一行（空字串＝移除），再部署
set_env_line() { good_env; grep -v "^$1=" "$SB/repo/.env" > "$SB/env.tmp"; cat "$SB/env.tmp" > "$SB/repo/.env"; [ -z "$2" ] || echo "$2" >> "$SB/repo/.env"; fresh_dist; }
set_env_line ALLOWED_ORIGINS ""; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "缺少 ALLOWED_ORIGINS：中止" "$([ $rc != 0 ] && out_has 'ALLOWED_ORIGINS' && ! log_has '^docker run'; echo $?)"
set_env_line CSRF_TRUSTED_ORIGINS ""; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "缺少 CSRF_TRUSTED_ORIGINS：中止" "$([ $rc != 0 ] && out_has 'CSRF_TRUSTED_ORIGINS' && ! log_has '^docker run'; echo $?)"
set_env_line AI_MONTHLY_BUDGET_USD ""; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "缺少 AI_MONTHLY_BUDGET_USD：中止" "$([ $rc != 0 ] && out_has 'AI_MONTHLY_BUDGET_USD' && ! log_has '^docker run'; echo $?)"
set_env_line AI_MONTHLY_BUDGET_USD "AI_MONTHLY_BUDGET_USD=abc"; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "AI_MONTHLY_BUDGET_USD 不是數字：中止" "$([ $rc != 0 ] && out_has 'AI_MONTHLY_BUDGET_USD'; echo $?)"
set_env_line AI_MONTHLY_BUDGET_USD "AI_MONTHLY_BUDGET_USD=0"; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "AI_MONTHLY_BUDGET_USD 是 0：中止" "$([ $rc != 0 ] && out_has 'AI_MONTHLY_BUDGET_USD'; echo $?)"
set_env_line AI_MONTHLY_BUDGET_USD ""; run_script deploy.sh SKIP_BACKUP=1 ALLOW_NO_AI_BUDGET=1; rc=$?
check "ALLOW_NO_AI_BUDGET=1 明確放行：沒有預算也能部署" "$([ $rc = 0 ]; echo $?)"
set_env_line AI_MONTHLY_BUDGET_USD "AI_MONTHLY_BUDGET_USD=12.5"; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "AI_MONTHLY_BUDGET_USD=12.5（小數）：通過" "$([ $rc = 0 ]; echo $?)"

GUEST_SECRET='GUEST_TRIAL_SECRET=abcdefghijklmnopqrstuvwxyz0123456789ABCD'
set_env_line GUEST_TRIAL_SECRET "$GUEST_SECRET"; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "啟用訪客試用但沒有全站每日上限：中止" "$([ $rc != 0 ] && out_has 'GUEST_TRIAL_GLOBAL_DAILY_LIMIT' && ! log_has '^docker run'; echo $?)"
set_env_line GUEST_TRIAL_SECRET "$GUEST_SECRET"; echo 'GUEST_TRIAL_GLOBAL_DAILY_LIMIT=0' >> "$SB/repo/.env"; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "全站每日上限是 0：中止" "$([ $rc != 0 ] && out_has 'GUEST_TRIAL_GLOBAL_DAILY_LIMIT'; echo $?)"
set_env_line GUEST_TRIAL_SECRET "$GUEST_SECRET"; echo 'GUEST_TRIAL_GLOBAL_DAILY_LIMIT=abc' >> "$SB/repo/.env"; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "全站每日上限不是數字：中止" "$([ $rc != 0 ] && out_has 'GUEST_TRIAL_GLOBAL_DAILY_LIMIT'; echo $?)"
set_env_line GUEST_TRIAL_SECRET "$GUEST_SECRET"; run_script deploy.sh SKIP_BACKUP=1 ALLOW_NO_GUEST_GLOBAL_LIMIT=1; rc=$?
check "ALLOW_NO_GUEST_GLOBAL_LIMIT=1 明確放行" "$([ $rc = 0 ]; echo $?)"
set_env_line GUEST_TRIAL_SECRET "$GUEST_SECRET"; echo 'GUEST_TRIAL_GLOBAL_DAILY_LIMIT=500' >> "$SB/repo/.env"; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "全站每日上限 500：通過" "$([ $rc = 0 ]; echo $?)"
good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "沒有啟用訪客試用：不要求全站每日上限" "$([ $rc = 0 ]; echo $?)"

good_env; echo 'INTERNAL_API_SECRET=short' >> "$SB/repo/.env"; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "INTERNAL_API_SECRET 太短：中止（稽核 DEP-7）" "$([ $rc != 0 ] && out_has 'INTERNAL_API_SECRET' && ! log_has '^docker run'; echo $?)"
good_env; echo 'INTERNAL_API_SECRET=0123456789012345678901234567890123456789' >> "$SB/repo/.env"; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "INTERNAL_API_SECRET 夠長：通過" "$([ $rc = 0 ]; echo $?)"

echo "backup.sh"
backup() { run_script deploy/backup.sh "$@"; }

printf 'DATABASE_URL=postgresql://u:p@h/db\nDICTIONARY_DATABASE_URL=postgresql://u:p@h/db\n' > "$SB/repo/.env"; rm -rf "$SB/repo/backups"
backup; rc=$?
check "兩個資料庫網址相同：只備份一份" "$([ $rc = 0 ] && [ "$(grep -c '^pg_dump ARGS' "$SB/log")" = 1 ]; echo $?)"

# 稽核 DEP-2：備份目錄 700、備份檔 600（Windows 的 Git Bash 不支援檔案權限位元時略過）
probe="$SB/modeprobe"; : > "$probe"; chmod 600 "$probe"
if [ "$(stat -c %a "$probe" 2>/dev/null)" = "600" ]; then
  mkdir -p "$SB/repo/backups"; chmod 755 "$SB/repo/backups"; rm -f "$SB/repo/backups"/*
  backup; rc=$?
  dump_file="$(ls "$SB/repo/backups"/django-*.dump 2>/dev/null | head -n 1)"
  check "備份目錄權限是 700（原本是 755 也會被收緊）、備份檔是 600"     "$([ $rc = 0 ] && [ "$(stat -c %a "$SB/repo/backups")" = "700" ] && [ "$(stat -c %a "$dump_file")" = "600" ]; echo $?)"
fi

printf 'DATABASE_URL=postgresql://u:p@h/db\nDICTIONARY_DATABASE_URL=postgresql://u:p@h/dict\n' > "$SB/repo/.env"
backup; rc=$?
check "辭典資料庫不同：備份兩份" "$([ $rc = 0 ] && [ "$(grep -c '^pg_dump ARGS' "$SB/log")" = 2 ]; echo $?)"

printf 'DATABASE_URL=postgresql://alice:s3cr%%40t@db.example:5433/appdb?sslmode=require\n' > "$SB/repo/.env"
backup; rc=$?
check "資料庫密碼只走環境變數：命令列參數完全不含密碼或連線字串" \
  "$([ $rc = 0 ] && ! grep '^pg_dump ARGS' "$SB/log" | grep -q -e 's3cr' -e 'postgresql://' -e 'alice'; echo $?)"
check "連線資訊正確拆解（含百分比編碼的密碼、port、sslmode）" \
  "$(log_has 'PGHOST=db.example PGPORT=5433 PGUSER=alice PGPASSWORD=s3cr@t PGDATABASE=appdb PGSSLMODE=require'; echo $?)"

printf 'export DATABASE_URL="postgresql://u:p@h/db" # 正式\r\n' > "$SB/repo/.env"
backup; rc=$?
check "備份腳本同樣能讀 CRLF、export、引號、行尾註解的 DATABASE_URL" "$([ $rc = 0 ] && log_has 'PGDATABASE=db'; echo $?)"

printf 'DATABASE_URL=postgresql://u:p@h/db\n' > "$SB/repo/.env"
rm -rf "$SB/repo/backups"; backup DUMP_EMPTY=1; rc=$?
check "備份檔是空的：失敗，且不留下檔案" "$([ $rc != 0 ] && [ -z "$(ls "$SB/repo/backups" 2>/dev/null)" ]; echo $?)"

rm -rf "$SB/repo/backups"; backup RESTORE_FAIL=1; rc=$?
check "備份檔無法被 pg_restore 讀取：失敗，且刪除損毀檔案" "$([ $rc != 0 ] && [ -z "$(ls "$SB/repo/backups" 2>/dev/null)" ]; echo $?)"

mkdir -p "$SB/repo/backups"; touch "$SB/repo/backups/old.dump"; touch -d '30 days ago' "$SB/repo/backups/old.dump" 2>/dev/null
backup RETENTION_DAYS=14; rc=$?
check "超過保留天數的舊備份被清掉，新備份保留" "$([ $rc = 0 ] && [ ! -f "$SB/repo/backups/old.dump" ] && ls "$SB/repo/backups" | grep -q '^django-'; echo $?)"

echo 'X=1' > "$SB/repo/.env"; backup; rc=$?
check "沒有 DATABASE_URL：失敗" "$([ $rc != 0 ] && out_has 'DATABASE_URL'; echo $?)"

echo
echo "通過 $PASS 項，失敗 $FAIL 項"
[ "$FAIL" = 0 ]
