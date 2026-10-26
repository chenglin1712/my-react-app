#!/usr/bin/env bash
# 重新產生 requirements.lock、requirements-dev.lock（每個套件附 SHA-256 雜湊）。
#
# 為什麼要有鎖定檔：requirements.txt 只固定「直接」套件的版本，間接相依的版本與內容沒人檢查。
# 用 `pip install --require-hashes -r requirements.lock` 安裝時，任何一個檔案的雜湊對不上就整個失敗，
# 套件庫上被偷換的檔案進不來。
#
# 什麼時候跑：改了 requirements.txt 或 requirements-dev.txt 之後。需要 uv（https://docs.astral.sh/uv/）。
# torch、torchaudio 不在鎖定檔裡：它們要從 PyTorch 自己的 index 安裝（見 requirements.txt 開頭的說明），
# 在 Dockerfile 與 CI 先單獨安裝。
set -euo pipefail
cd "$(dirname "$0")/.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

grep -vE '^(torch|torchaudio)==' requirements.txt > "$tmp/prod.in"
{ cat "$tmp/prod.in"; grep -vE '^(#|-r|[[:space:]]*$)' requirements-dev.txt; } > "$tmp/dev.in"

compile() {
  local input="$1" output="$2" source="$3"
  uv pip compile "$input" --generate-hashes --no-annotate --no-header \
    --python-version 3.12 --python-platform linux -o "$tmp/out.txt"
  {
    echo "# 由 scripts/compile_requirements.sh 產生（來源：$source），每個套件附 SHA-256 雜湊。"
    echo "# 安裝：pip install --require-hashes -r $output。不要手改；改了來源檔就重新執行該腳本。"
    cat "$tmp/out.txt"
  } > "$output"
}

compile "$tmp/prod.in" requirements.lock requirements.txt
compile "$tmp/dev.in" requirements-dev.lock "requirements.txt + requirements-dev.txt"
echo "已更新 requirements.lock、requirements-dev.lock"
