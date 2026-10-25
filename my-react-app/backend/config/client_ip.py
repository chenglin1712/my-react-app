"""Django 端取得「真實來源 IP」的共用方式（S-02）。

正式環境的流量是 nginx → gunicorn（綁 127.0.0.1），gunicorn 不會用 X-Forwarded-For 改寫 REMOTE_ADDR，
所以 request.META["REMOTE_ADDR"] 永遠是 127.0.0.1：所有訪客看起來都來自同一個 IP，依 IP 限流的公開端點
變成全站共用同一份額度（一個人刷滿，所有人被擋），稽核紀錄裡的 IP 也全是 127.0.0.1。

做法與 FastAPI 那邊 uvicorn 的預設一致：只有「連進來的那一跳」是受信任的代理（預設本機）時，才採信
X-Forwarded-For；由右往左跳過受信任的代理，第一個不受信任的位址就是真實來源。最右邊是 nginx 附加的，
客戶端自己偽造的值在左邊，不會被採用。直接連線（REMOTE_ADDR 不是受信任代理）時完全不看這個標頭。

TRUSTED_PROXY_IPS（逗號分隔，選填）：nginx 前面還有負載平衡器或 CDN 時，把它們的位址或網段（例如 10.0.0.0/8）
一起列進來，否則取到的會是負載平衡器的位址。預設只信任本機。
**注意：** 加了前一層代理之後，最外層那一台 nginx 必須用 real_ip 模組只信任該代理的網段、並把「驗證過的來源」
重建成 X-Forwarded-For；如果它仍照單全收客戶端送來的值，鏈會變成「偽造的位址, 前層代理」，前層代理被跳過後，
偽造的位址就會被採用。
"""
from __future__ import annotations

import ipaddress
import os

_DEFAULT_TRUSTED = ("127.0.0.1", "::1")


def _normalize(value: str) -> str:
    """統一位址的寫法（大小寫、縮寫、IPv4 對映的 IPv6），解析不出來的原樣回傳。"""
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return value
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        return str(address.ipv4_mapped)
    return str(address)


def _trusted_networks() -> list:
    """受信任代理的位址或網段。設定值寫錯的項目略過（不是合法位址或網段）；略過只會讓信任變少，不會變多。"""
    networks = []
    raw = os.getenv("TRUSTED_PROXY_IPS", "")
    for item in [*_DEFAULT_TRUSTED, *(part.strip() for part in raw.split(","))]:
        if not item:
            continue
        try:
            networks.append(ipaddress.ip_network(item, strict=False))
        except ValueError:
            continue
    return networks


def _is_trusted(value: str, networks: list) -> bool:
    try:
        address = ipaddress.ip_address(_normalize(value))
    except ValueError:
        return False
    return any(address.version == network.version and address in network for network in networks)


def valid_ip_or_none(value: str | None) -> str | None:
    """給寫進 GenericIPAddressField（稽核紀錄）用：不是合法位址（例如 "unknown"）就回 None，避免資料庫寫入失敗。"""
    if not value:
        return None
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return None
    return value


def client_ip(request) -> str:
    """回傳這個請求的真實來源 IP；取不到時回傳 "unknown"。"""
    remote = (request.META.get("REMOTE_ADDR") or "").strip()
    if not remote:
        return "unknown"
    remote = _normalize(remote)
    networks = _trusted_networks()
    if not _is_trusted(remote, networks):
        return remote

    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    for hop in reversed([item.strip() for item in forwarded.split(",")]):
        if not hop:
            continue
        try:
            ipaddress.ip_address(hop)
        except ValueError:
            # 不是合法的位址（偽造或亂填）：不能採用，也不能再往左找，否則攻擊者能用垃圾值把真實位址擠掉
            return remote
        if not _is_trusted(hop, networks):
            return _normalize(hop)
    return remote
