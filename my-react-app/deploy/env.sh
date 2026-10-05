#!/usr/bin/env bash
# deploy.sh 與 deploy/backup.sh 共用的 .env 讀取函式（請用 `. deploy/env.sh` 載入，不要直接執行）。
#
# 刻意不 source 整份 .env（裡面可能有指令替換或不合法的 shell 語法），也不用單純的
# grep|cut：.env 在 Windows 編輯過會帶 CRLF，也常見 `export KEY=...`、`KEY = value`、
# `KEY="value" # 註解` 這些寫法，漏判 DJANGO_DEBUG 會讓部署前的防呆形同虛設。
#
# 支援：CRLF、export 前綴、等號兩邊的空白、單／雙引號（引號內的 # 屬於值的一部分）、
# 未加引號時行尾的 ` # 註解`、值本身含 `=`。同一個變數出現多次時取最後一次。
# 不支援：多行值、變數展開（${VAR}）——這份專案的 .env 沒有用到。

# env_value <變數名稱>：印出值；變數不存在或 .env 不存在時印出空字串
env_value() {
  [ -f .env ] || return 0
  local line val
  line=$(tr -d '\r' < .env | sed -E 's/^[[:space:]]*(export[[:space:]]+)?//' | grep -E "^$1[[:space:]]*=" | tail -n1) || true
  [ -n "$line" ] || return 0
  val=${line#*=}
  val=$(printf '%s' "$val" | sed -E 's/^[[:space:]]+//')
  case "$val" in
    \"*) val=${val#\"}; val=${val%%\"*} ;;
    \'*) val=${val#\'}; val=${val%%\'*} ;;
    *)   val=$(printf '%s' "$val" | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//') ;;
  esac
  printf '%s' "$val"
}

# is_true <值>：1／true／yes（不分大小寫）視為真
is_true() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes) return 0 ;;
    *) return 1 ;;
  esac
}
