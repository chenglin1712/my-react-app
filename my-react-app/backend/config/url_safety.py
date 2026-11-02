"""共用的「第二跳網址是否安全」檢查。

routes/dictionary.py 的 proxy_audio／debug_audio 與 routes/quiz.py 的
fetch_audio_from_id 都是同一種模式：先對一個固定、半信任的第三方來源
（見 config/audio_source.py 的 get_ilrdf_audio_api）發第一次請求，取得它
回傳的重導向網址或純文字網址，再對「那個網址」發第二次請求把實際內容抓
回來。第二次請求的目標
完全由第一次請求的回應內容決定，原本沒有任何檢查——與 quiz.py 的
compare_audio.reference_urls 已經修好、有白名單＋禁止 redirect 的作法不一致。

跟 reference_urls（前端直接傳入、能透過白名單鎖定已知的 Firebase Storage 網域）
不同，這裡第二跳的網址來自第三方服務的回應，實際會導去哪個 CDN 網域未知，寫死
網域白名單容易誤擋合法回應。改成只擋「明顯是內部/私有位址」這一類（RFC1918
私有網段、loopback、link-local，含雲端環境常見的 metadata endpoint
169.254.169.254），不限制網域本身，兩者互補而非取代彼此的用途。

原本放在 backend/fastAPI/ 底下，但整支檔案零框架依賴（只用 ipaddress／
socket／urllib.parse，assert_response_from_safe_peer() 是用 duck typing 吃一個
有 .extensions 屬性的物件，沒有真的 import httpx），Django 端的
adminapi/management/commands/migrate_dictionary_media.py 也要用這幾個函式，
原本得反過來 import FastAPI 的內部模組（見 P4 review BE-7）。搬到
backend/config 這個 Django/FastAPI 共用層，兩邊都改成從這裡 import。
"""
import ipaddress
import socket
from dataclasses import dataclass, field
from urllib.parse import urlparse

# Python 的 is_private／is_global 在不同版本結果不一致，下列網段明確列為不可連線（稽核 FIL-2）：
# 100.64.0.0/10 是 CGNAT 共享位址（雲端常把 metadata 服務放在這裡，例如 100.100.100.200），
# 192.0.0.0/24 是 IETF 保留，198.18.0.0/15 是測試網段，240.0.0.0/4 是保留。
_BLOCKED_NETWORKS = tuple(ipaddress.ip_network(n) for n in (
    "0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "198.18.0.0/15", "240.0.0.0/4", "255.255.255.255/32",
))
_NAT64_PREFIX = ipaddress.ip_network("64:ff9b::/96")


def _embedded_ipv4(ip):
    """IPv6 位址裡內嵌的 IPv4（IPv4-mapped、6to4、Teredo、NAT64）；沒有就回傳空串列。
    攻擊者能用這些寫法把內網位址包成「看起來像公開 IPv6」，所以要解開後用 IPv4 的規則再判斷一次。"""
    if not isinstance(ip, ipaddress.IPv6Address):
        return []
    if ip.ipv4_mapped is not None:
        return [ip.ipv4_mapped]
    if ip.sixtofour is not None:
        return [ip.sixtofour]
    if ip.teredo is not None:
        return list(ip.teredo)           # (伺服器, 客戶端) 兩個都要是公開位址
    if ip in _NAT64_PREFIX:
        return [ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)]
    return []


def is_public_ip(ip) -> bool:
    """只有全球可路由的單播位址才算公開。用 not is_global 而不是列舉 is_private 等屬性——
    後者會漏掉 CGNAT 這類「不算 private、也不是全球可路由」的網段。"""
    for embedded in _embedded_ipv4(ip):
        if not is_public_ip(embedded):
            return False
    if ip.is_multicast or ip.is_unspecified or ip.is_loopback or ip.is_link_local or not ip.is_global:
        return False
    if isinstance(ip, ipaddress.IPv4Address) and any(ip in net for net in _BLOCKED_NETWORKS):
        return False
    return True


def _resolves_to_public_address(hostname: str) -> bool:
    try:
        addr_info = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return False
    for _family, _type, _proto, _canonname, sockaddr in addr_info:
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            return False
        if not is_public_ip(ip):
            return False
    return True


def is_safe_redirect_target(url: str) -> bool:
    """給第一次請求回應裡帶的「下一跳網址」用：只允許 http(s)，且主機名解析出來
    的位址不能是內網／loopback／link-local。"""
    if not url:
        return False
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    return _resolves_to_public_address(parsed.hostname)


class UnsafeConnectionError(Exception):
    """assert_response_from_safe_peer() 判定實際連線位址不安全時丟出。"""


def assert_response_from_safe_peer(response) -> None:
    """給呼叫端在發出第二次請求「之後」用：驗證真正建立連線的那個 IP 是否安全。

    is_safe_redirect_target() 是在發出第二次請求之前，對網址做一次獨立的 DNS
    解析來判斷安不安全；但 httpx／requests 實際發出那次請求時，會自己再重新
    對同一個網域做一次 DNS 解析，不會沿用前面檢查時解析到的結果。如果同一個
    網域在這兩次解析之間回傳不同結果（低 TTL、DNS rebinding 攻擊），檢查當下
    看到的可以是合法公開 IP，實際連線卻連到內網位址，等於防護被繞過
    （TOCTOU）。

    這裡不試圖讓兩次解析變成同一次（httpx 沒有公開 API 能讓呼叫端指定要連去
    哪個 IP、同時又正確處理 HTTPS 的 SNI／憑證驗證），而是反過來：直接檢查
    「這個回應實際上是從哪個 IP 收到的」——這是真正被拿來收發資料的那個位址，
    不會再有第二次解析的落差。呼叫端要在讀取／回傳 response 內容之前呼叫這個
    函式，位址不安全時整個回應都不該被信任。

    只支援 httpx 的 Response（response.extensions["network_stream"] 是 httpx
    公開但標示為進階用法的介面，經測試在 sync/async Client 皆可用）。
    """
    network_stream = response.extensions.get("network_stream")
    peer = network_stream.get_extra_info("server_addr") if network_stream else None
    if not peer or not peer[0]:
        raise UnsafeConnectionError("無法確認連線目標，拒絕信任這個回應")
    try:
        ip = ipaddress.ip_address(peer[0])
    except ValueError:
        raise UnsafeConnectionError("無法確認連線目標，拒絕信任這個回應")
    if not is_public_ip(ip):
        raise UnsafeConnectionError(f"連線目標位址不允許：{peer[0]}")


@dataclass(frozen=True)
class PinnedTarget:
    """已固定解析結果的請求目標。url 的主機部分換成檢查過的 IP；headers 補回原本的 Host；
    extensions 讓 httpx 用原本的網域做 TLS 的 SNI 與憑證驗證（https 才有）。"""
    url: str
    headers: dict = field(default_factory=dict)
    extensions: dict = field(default_factory=dict)


def pin_target(url: str) -> PinnedTarget:
    """解析網域、確認【所有】解析結果都是公開位址，再回傳「直接連那個 IP」的請求目標。

    發出請求前才做一次解析並直接拿結果去連線，連線時就不會再有第二次 DNS 查詢，DNS rebinding
    沒有可以插進去的空隙（稽核 FIL-2）。assert_response_from_safe_peer 仍保留當第二層檢查。
    不合格丟 UnsafeConnectionError。getaddrinfo 會阻塞，async 呼叫端請用 asyncio.to_thread。"""
    try:
        parsed = urlparse(url)
        port = parsed.port
    except ValueError:
        raise UnsafeConnectionError("網址格式不合法")
    host = parsed.hostname
    if parsed.scheme not in ("http", "https") or not host:
        raise UnsafeConnectionError("只允許 http／https 網址")
    if parsed.username is not None or parsed.password is not None:
        raise UnsafeConnectionError("網址不可帶帳號密碼")

    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if not is_public_ip(literal):
            raise UnsafeConnectionError(f"連線目標位址不允許：{host}")
        return PinnedTarget(url)

    try:
        infos = socket.getaddrinfo(host, port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError):
        raise UnsafeConnectionError("無法解析網域")
    addresses = []
    for _family, _type, _proto, _canonname, sockaddr in infos:
        try:
            addresses.append(ipaddress.ip_address(sockaddr[0]))
        except ValueError:
            raise UnsafeConnectionError("解析結果不是有效的位址")
    if not addresses or not all(is_public_ip(a) for a in addresses):
        raise UnsafeConnectionError("網域解析到不允許的位址")

    chosen = sorted(addresses, key=lambda a: a.version)[0]       # 優先 IPv4：許多主機沒有可用的 IPv6 路由
    ip_text = f"[{chosen}]" if chosen.version == 6 else str(chosen)
    netloc = ip_text + (f":{port}" if port else "")
    host_header = host + (f":{port}" if port else "")
    return PinnedTarget(
        url=parsed._replace(netloc=netloc).geturl(),
        # Connection: close：連線池是以 URL 裡的 IP 當 key，兩個網域解析到同一個 IP 時，不關閉的話
        # 第二個網域可能重用第一個網域的 TLS 連線（憑證與 SNI 都是前一個網域的）
        headers={"Host": host_header, "Connection": "close"},
        extensions={"sni_hostname": host} if parsed.scheme == "https" else {},
    )
