#!/usr/bin/env bash
# deploy.sh 與 deploy/backup.sh 的行為測試。
#
# 在暫存目錄用「假的」docker／git／curl／pg_dump 執行真正的腳本，驗證各條路徑：
# 成功、健康檢查失敗自動回滾、.env 防呆、備份失敗中止、反向代理檢查失敗只報錯不回滾、
# 備份檔檢查與舊備份清理。不需要 docker 或資料庫，CI 與本機都能跑。
# 用法：bash deploy/test_deploy.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
PASS=0
FAIL=0

mkdir -p "$SB/bin" "$SB/state" "$SB/repo/deploy"
cp "$ROOT/deploy.sh" "$SB/repo/deploy.sh"
cp "$ROOT/deploy/backup.sh" "$SB/repo/deploy/backup.sh"

# ── 假的外部指令 ─────────────────────────────────────────────────
cat > "$SB/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$SB_LOG"
if [ "$1 $2" = "image inspect" ]; then exit 0; fi
if [ "$1" = "compose" ]; then
  case "$*" in
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
cat > "$SB/bin/pg_dump" <<'EOF'
#!/usr/bin/env bash
echo "pg_dump $*" >> "$SB_LOG"
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

fresh_dist() { rm -rf "$SB/repo/dist" "$SB/repo/dist.prev"; mkdir -p "$SB/repo/dist"; echo old > "$SB/repo/dist/index.html"; }

check() { # 名稱 條件結果(0=通過)
  if [ "$2" = "0" ]; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1"; sed 's/^/       | /' "$SB/out" | tail -8; fi
}
out_has() { grep -q -- "$1" "$SB/out"; }
log_has() { grep -q -- "$1" "$SB/log"; }

# ── deploy.sh ───────────────────────────────────────────────────
echo "deploy.sh"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "成功路徑：結束碼 0、dist 換成新版、回滾點已清掉" "$([ $rc = 0 ] && [ "$(cat "$SB/repo/dist/index.html")" = new ] && [ ! -d "$SB/repo/dist.prev" ]; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1 FAIL_UP=1; rc=$?
check "健康檢查失敗：結束碼非 0、自動回滾（dist 還原、:prev 標回 :latest）" \
  "$([ $rc != 0 ] && [ "$(cat "$SB/repo/dist/index.html")" = old ] && log_has "docker tag yuanyu-django:prev yuanyu-django:latest"; echo $?)"

good_env; sed -i 's/DJANGO_DEBUG=False/DJANGO_DEBUG=True/' "$SB/repo/.env"; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "DJANGO_DEBUG=True：中止，且完全沒有呼叫 docker" "$([ $rc != 0 ] && out_has 'DJANGO_DEBUG' && ! log_has '^docker'; echo $?)"

good_env; sed -i 's/AUTH_DEV_BYPASS=False/AUTH_DEV_BYPASS="True"  # 開發用/' "$SB/repo/.env"; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "AUTH_DEV_BYPASS 帶引號與行尾註解仍能辨識為 True 並中止" "$([ $rc != 0 ] && out_has 'AUTH_DEV_BYPASS'; echo $?)"

good_env; sed -i '/DATABASE_URL/d' "$SB/repo/.env"; fresh_dist; run_script deploy.sh SKIP_BACKUP=1; rc=$?
check "缺少 DATABASE_URL：中止" "$([ $rc != 0 ] && out_has 'DATABASE_URL'; echo $?)"

good_env; printf '#!/usr/bin/env bash\nexit 1\n' > "$SB/repo/deploy/backup.sh"; fresh_dist; run_script deploy.sh; rc=$?
check "備份失敗：中止，且沒有進入建置" "$([ $rc != 0 ] && out_has '備份失敗' && ! log_has 'compose.* build'; echo $?)"
cp "$ROOT/deploy/backup.sh" "$SB/repo/deploy/backup.sh"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1 ROUTE_CODE=404; rc=$?
check "代理路由 404：結束碼非 0，但不回滾（容器與 dist 維持新版）" \
  "$([ $rc != 0 ] && out_has '反向代理檢查未通過' && [ "$(cat "$SB/repo/dist/index.html")" = new ] && ! log_has 'docker tag yuanyu-django:prev'; echo $?)"

good_env; fresh_dist; run_script deploy.sh SKIP_BACKUP=1 CURL_RC=7 ROUTE_CODE=000; rc=$?
check "代理連不上：結束碼非 0" "$([ $rc != 0 ] && out_has 'FAIL'; echo $?)"

# ── backup.sh ───────────────────────────────────────────────────
echo "backup.sh"
backup() { run_script deploy/backup.sh "$@"; }

printf 'DATABASE_URL=postgresql://u:p@h/db\nDICTIONARY_DATABASE_URL=postgresql://u:p@h/db\n' > "$SB/repo/.env"; rm -rf "$SB/repo/backups"
backup; rc=$?
check "兩個資料庫網址相同：只備份一份" "$([ $rc = 0 ] && [ "$(grep -c '^pg_dump' "$SB/log")" = 1 ]; echo $?)"

printf 'DATABASE_URL=postgresql://u:p@h/db\nDICTIONARY_DATABASE_URL=postgresql://u:p@h/dict\n' > "$SB/repo/.env"
backup; rc=$?
check "辭典資料庫不同：備份兩份" "$([ $rc = 0 ] && [ "$(grep -c '^pg_dump' "$SB/log")" = 2 ]; echo $?)"

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
