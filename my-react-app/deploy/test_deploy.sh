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
      if [ "${FAIL_UP:-0}" = "1" ] && [ ! -f "$SB_STATE/up_failed" ]; then touch "$SB_STATE/up_failed"; exit 1; fi ;;
  esac
fi
if [ "$1" = "run" ]; then mkdir -p dist && echo new > dist/index.html; fi
exit 0
EOF
cat > "$SB/bin/git" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  rev-parse) if [ "$2" = "--short" ]; then echo abc1234; elif [ -f "$SB_STATE/pulled" ]; then echo bbbb; else echo aaaa; fi ;;
  pull) touch "$SB_STATE/pulled" ;;
esac
EOF
cat > "$SB/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> "$SB_LOG"
case "$*" in *"-w %{http_code}"*) printf '%s' "${ROUTE_CODE:-401}" ;; esac
exit "${CURL_RC:-0}"
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
printf '#!/usr/bin/env bash\nexit 0\n' > "$SB/bin/sudo"
chmod +x "$SB/bin/"*

# ── 工具函式 ─────────────────────────────────────────────────────
good_env() {
  printf 'DJANGO_SECRET_KEY=x\nDJANGO_DEBUG=False\nAUTH_DEV_BYPASS=False\nDATABASE_URL=postgresql://u:p@h/db\n' > "$SB/repo/.env"
  echo '{}' > "$SB/repo/serviceAccountKey.json"
}

# run_script <腳本> [環境變數=值 ...]：結果寫到 $SB/out，回傳腳本的結束碼
run_script() {
  local script="$1"; shift
  : > "$SB/log"; rm -rf "$SB/state"/*
  ( cd "$SB/repo" && env PATH="$SB/bin:$PATH" SB_LOG="$SB/log" SB_STATE="$SB/state" USER=tester "$@" bash "$script" --force ) > "$SB/out" 2>&1
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
good_env; printf 'DJANGO_SECRET_KEY=x\n# DJANGO_DEBUG=True\nDJANGO_DEBUG=False\nDATABASE_URL=postgresql://u:p@h/db\n' > "$SB/repo/.env"; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "被註解掉的 DJANGO_DEBUG=True 不算數，不會誤擋（部署成功）" "$([ $rc = 0 ]; echo $?)"

# ── backup.sh ───────────────────────────────────────────────────
echo "backup.sh"
backup() { run_script deploy/backup.sh "$@"; }

printf 'DATABASE_URL=postgresql://u:p@h/db\nDICTIONARY_DATABASE_URL=postgresql://u:p@h/db\n' > "$SB/repo/.env"; rm -rf "$SB/repo/backups"
backup; rc=$?
check "兩個資料庫網址相同：只備份一份" "$([ $rc = 0 ] && [ "$(grep -c '^pg_dump ARGS' "$SB/log")" = 1 ]; echo $?)"

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
