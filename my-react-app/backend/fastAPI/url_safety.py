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
