#!/usr/bin/env bash
# 為正式伺服器申請 Let's Encrypt 憑證（網域或單一 IP 位址都可以）。
#
# 用法（在伺服器上，需要 root）：
#   sudo bash deploy/enable-https.sh 35.221.174.29          # IP 位址（6 天短效憑證，會自動續期）
#   sudo bash deploy/enable-https.sh app.example.com        # 網域（一般 90 天憑證）
#   sudo STAGING=1 bash deploy/enable-https.sh 35.221.174.29   # 先用測試環境演練（簽出的憑證瀏覽器不信任，但不佔正式額度）
#   EMAIL=你的信箱 可選：憑證快過期或出問題時 Let's Encrypt 會寄信（IP 憑證 6 天一換，建議填）
#
# 這個腳本只負責「取得並自動續期憑證」，不會改你的 nginx 設定（nginx 的 ssl_certificate 路徑要自己確認）。
# 前置條件：
#   1. 80 與 443 埠對外開放（Google Cloud：VPC 網路 → 防火牆，允許 tcp:80、tcp:443；VM 的網路標記要套到規則）。
#   2. nginx 的 80 埠 server 要有 /.well-known/acme-challenge/ 的 location，root 指向 /var/www/certbot
#      （deploy/nginx.conf 已有；伺服器上的設定若是舊的要先更新，這個腳本會檢查）。
#   3. IP 位址模式：這個 IP 必須是「靜態」的（Google Cloud：VPC 網路 → IP 位址 → 把臨時位址「預留」為靜態）。
#      臨時位址在 VM 停止再啟動後會變，憑證就對不上了。
#   4. IP 位址憑證需要 certbot 5.4 以上（webroot 模式才支援 IP）；Ubuntu 內建的 apt 版本太舊，這裡改用 snap 版。
set -euo pipefail

ID="${1:-}"
WEBROOT="${WEBROOT:-/var/www/certbot}"
RELOAD_CMD="${RELOAD_CMD:-systemctl reload nginx}"

die() { echo "!! $*" >&2; exit 1; }

[ -n "$ID" ] || die "請給網域或 IP：sudo bash deploy/enable-https.sh <網域或IP>"
[ "$(id -u)" = "0" ] || die "需要 root：請用 sudo 執行"

if [[ "$ID" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  MODE=ip
  ID_ARGS=(--ip-address "$ID" --preferred-profile shortlived)
else
  MODE=domain
  ID_ARGS=(-d "$ID")
fi
echo "==> 模式：$MODE（$ID）"

# ── certbot 版本 ──
need_snap_certbot=0
if command -v certbot >/dev/null 2>&1; then
  ver="$(certbot --version 2>&1 | awk '{print $2}')"
  # 5.4 以上才行（IP 模式）；網域模式任何近期版本都可以
  if [ "$MODE" = ip ] && ! printf '5.4.0\n%s\n' "$ver" | sort -V -C; then need_snap_certbot=1; fi
else
  need_snap_certbot=1
fi
if [ "$need_snap_certbot" = 1 ]; then
  command -v snap >/dev/null 2>&1 || die "沒有 snap，無法安裝新版 certbot。請改用 pip 安裝 certbot>=5.4，或參考 https://certbot.eff.org/instructions"
  echo "==> 安裝／更新 snap 版 certbot"
  # 舊的 apt 版會被 snap 版的 /usr/bin/certbot 連結蓋過，先移除避免續期排程重複
  apt-get remove -y certbot >/dev/null 2>&1 || true
  if snap list certbot >/dev/null 2>&1; then snap refresh certbot || true; else snap install --classic certbot; fi
  ln -sf /snap/bin/certbot /usr/bin/certbot
  hash -r
  ver="$(certbot --version 2>&1 | awk '{print $2}')"
  if [ "$MODE" = ip ] && ! printf '5.4.0\n%s\n' "$ver" | sort -V -C; then die "certbot $ver 仍低於 5.4，不支援 IP 憑證"; fi
fi
echo "==> certbot $(certbot --version 2>&1 | awk '{print $2}')"

# ── nginx 的 80 埠要能回應驗證檔 ──
command -v nginx >/dev/null 2>&1 || die "找不到 nginx"
nginx -t >/dev/null 2>&1 || die "nginx -t 沒通過，請先修好現有設定"
nginx_dump="$(nginx -T 2>/dev/null)"   # 存進變數：直接接 grep -q 會因 pipefail 與 SIGPIPE 誤判失敗
case "$nginx_dump" in
  *"/.well-known/acme-challenge/"*) ;;
  *) die "nginx 設定沒有 /.well-known/acme-challenge/ 的 location。請先套用 deploy/nginx.conf 的 80 埠區塊（含 root $WEBROOT）後 nginx -t && $RELOAD_CMD" ;;
esac
mkdir -p "$WEBROOT/.well-known/acme-challenge"
# 實際從 80 埠讀一個測試檔：確認驗證路徑真的會被這個 IP／網域命中，而不是被別的 server 區塊截走
probe="probe-$$-$RANDOM"
echo ok > "$WEBROOT/.well-known/acme-challenge/$probe"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$ID/.well-known/acme-challenge/$probe" || true)"
rm -f "$WEBROOT/.well-known/acme-challenge/$probe"
[ "$code" = 200 ] || die "從 http://$ID/.well-known/acme-challenge/ 讀測試檔得到 HTTP $code（預期 200）。檢查：80 埠防火牆、nginx 的 80 埠 server_name 與 root、這個 IP／網域是否真的指到這台機器"

# ── 申請 ──
extra=()
[ "${STAGING:-0}" = 1 ] && extra+=(--staging) && echo "==> 測試環境演練（STAGING=1）：憑證不會被瀏覽器信任"
if [ -n "${EMAIL:-}" ]; then extra+=(-m "$EMAIL"); else extra+=(--register-unsafely-without-email); fi

certbot certonly --non-interactive --agree-tos \
  --webroot -w "$WEBROOT" \
  --cert-name "$ID" "${ID_ARGS[@]}" "${extra[@]}" \
  --deploy-hook "$RELOAD_CMD"

LIVE="/etc/letsencrypt/live/$ID"
[ -s "$LIVE/fullchain.pem" ] || die "沒有產生 $LIVE/fullchain.pem"

echo
echo "==> 憑證已取得："
openssl x509 -in "$LIVE/fullchain.pem" -noout -subject -issuer -dates
echo
echo "下一步：nginx 的 443 區塊改成這兩行與 server_name，然後 nginx -t && $RELOAD_CMD"
echo "    server_name $ID;"
echo "    ssl_certificate     $LIVE/fullchain.pem;"
echo "    ssl_certificate_key $LIVE/privkey.pem;"
echo
if systemctl list-timers --all 2>/dev/null | grep -qE 'certbot|snap\.certbot'; then
  echo "續期排程：已存在（systemctl list-timers | grep certbot）"
else
  echo "!! 沒看到 certbot 的續期排程，請確認 snap 版 certbot 的 timer 已啟用（IP 憑證 6 天一換，排程缺席就會過期）"
fi
echo "續期：certbot 會每天自動檢查，換新後自動執行「$RELOAD_CMD」。"
echo "驗證續期流程可用：sudo certbot renew --dry-run"
echo "（IP 憑證只有約 6 天，續期失敗 6 天內瀏覽器就會再次顯示不安全，上線後請確認 systemctl list-timers | grep certbot 有排程。）"
