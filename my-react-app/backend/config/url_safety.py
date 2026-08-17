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
from urllib.parse import urlparse


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
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
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
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
        raise UnsafeConnectionError(f"連線目標位址不允許：{peer[0]}")
