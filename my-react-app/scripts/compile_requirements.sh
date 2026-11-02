#!/usr/bin/env bash
# 重新產生 requirements.lock、requirements-dev.lock（每個套件附 SHA-256 雜湊）。
#
# 為什麼要有鎖定檔：requirements.txt 只固定「直接」套件的版本，間接相依的版本與內容沒人檢查。
# 用 `pip install --require-hashes -r requirements.lock` 安裝時，任何一個檔案的雜湊對不上就整個失敗，
# 套件庫上被偷換的檔案進不來。
#
# 什麼時候跑：改了 requirements.txt 或 requirements-dev.txt 之後。需要 uv（https://docs.astral.sh/uv/）。
# torch、torchaudio 不在 requirements.lock 裡：它們要從 PyTorch 自己的 index 安裝（見 requirements.txt 開頭的說明），
# 另外編成 requirements-torch.lock（同樣每個檔案附 SHA-256，稽核 SUP-1）：裡面「只有」torch 與 torchaudio 兩個檔案，
# 只從 PyTorch CPU index 解析，不加 PyPI 當第二個索引（避免相依混淆），安裝時用 --index-url 指到同一個 index、
# --require-hashes、--no-deps。它們的執行期相依（TORCH_RUNTIME_DEPS）改由 PyPI 提供、同樣帶雜湊，放在 requirements.lock：
# PyTorch 的 index 只鏡像少數舊版第三方套件（例如 setuptools 只有 78.1.0，已有已知漏洞），不能拿來解析相依。
# 安全性來自「每個檔案的雜湊都要對得上」，不是索引唯一；安裝完成後的 pip check 確認各份鎖定檔的版本彼此相容。
#
# 用法：
#   scripts/compile_requirements.sh          重編全部（requirements.lock、requirements-dev.lock、requirements-torch.lock）
#                                            注意：會把所有套件解析到目前最新版，不只是 torch。
#   scripts/compile_requirements.sh torch    只重編 requirements-torch.lock，其他鎖定檔完全不動。
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-all}"
case "$mode" in
  all|torch) ;;
  *) echo "用法：$0 [all|torch]" >&2; exit 2 ;;
esac

TORCH_INDEX="https://download.pytorch.org/whl/cpu"
# torch／torchaudio 的 CPU wheel 宣告的執行期相依（版本下限寬鬆，由 PyPI 解析最新版）；torch 版本升級時對照 wheel 的 METADATA。
TORCH_RUNTIME_DEPS="filelock fsspec jinja2 networkx setuptools sympy"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

compile_torch() {
  grep -E '^(torch|torchaudio)==' requirements.txt > "$tmp/torch.in"
  uv pip compile "$tmp/torch.in" --generate-hashes --no-annotate --no-header --no-deps \
    --python-version 3.12 --python-platform linux --index-url "$TORCH_INDEX" -o "$tmp/torch-out.txt"
  {
    echo "# 由 scripts/compile_requirements.sh 產生（來源：requirements.txt 的 torch、torchaudio），每個檔案附 SHA-256 雜湊。"
    echo "# 只從 $TORCH_INDEX 解析，且只含這兩個套件；它們的相依在 requirements.lock（從 PyPI、同樣帶雜湊）。"
    echo "# 安裝：pip install --require-hashes --no-deps --index-url $TORCH_INDEX -r requirements-torch.lock"
    echo "# 不要手改；改了 requirements.txt 的 torch 版本就重新執行該腳本。"
    cat "$tmp/torch-out.txt"
  } > requirements-torch.lock
  echo "已更新 requirements-torch.lock"
}

if [ "$mode" = "torch" ]; then
  compile_torch
  exit 0
fi

{ grep -vE '^(torch|torchaudio)==' requirements.txt; for dep in $TORCH_RUNTIME_DEPS; do echo "$dep"; done; } > "$tmp/prod.in"
{ cat "$tmp/prod.in"; grep -vE '^(#|-r|[[:space:]]*$)' requirements-dev.txt; } > "$tmp/dev.in"

compile() {
  local input="$1" output="$2" source="$3" extra=() pkg
  # UPGRADE_PACKAGES="pyasn1 urllib3"：只升這些套件（例如 pip-audit 回報了修正版），其餘版本以現有鎖定檔為準、不動。
  # 沒設定時維持原行為：全部解析到目前最新版。
  if [ -n "${UPGRADE_PACKAGES:-}" ]; then
    cp "$output" "$tmp/out.txt"
    for pkg in $UPGRADE_PACKAGES; do extra+=(--upgrade-package "$pkg"); done
  fi
  uv pip compile "$input" --generate-hashes --no-annotate --no-header \
    --python-version 3.12 --python-platform linux ${extra[@]+"${extra[@]}"} -o "$tmp/out.txt"
  {
    echo "# 由 scripts/compile_requirements.sh 產生（來源：$source），每個套件附 SHA-256 雜湊。"
    echo "# 安裝：pip install --require-hashes -r $output。不要手改；改了來源檔就重新執行該腳本。"
    cat "$tmp/out.txt"
  } > "$output"
}

compile "$tmp/prod.in" requirements.lock requirements.txt
compile "$tmp/dev.in" requirements-dev.lock "requirements.txt + requirements-dev.txt"
echo "已更新 requirements.lock、requirements-dev.lock"
compile_torch
