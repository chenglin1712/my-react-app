"""填字題目憑證（稽核 BE5-09：把判分搬到伺服器）。

產生題目時，把「完整解答與圖例（含答案單字）」加密成一個憑證交給前端保管；前端只拿到遮蔽過的網格與不含答案的提示。
提交作答時前端把憑證原樣送回，伺服器解密後用裡面的解答判分——前端送來的任何解答、圖例都不再被採信。

為什麼是「加密的憑證」而不是存在快取：正式環境有多個 gunicorn worker，沒有 REDIS_URL 時快取是各 worker 自己的記憶體，
提交可能落到另一個 worker 而找不到題目。加密憑證不需要共用狀態。
- 加密（Fernet，含驗證）：前端讀不到答案，也改不了內容。
- 綁使用者：憑證裡有 uid，別人拿到也不能用。
- 有效期限：超過 TOKEN_TTL_SECONDS 視為過期。

已知限制：憑證在有效期限內可重複提交（先交空白看答案、再交一次拿滿分）。目前分數沒有存到伺服器，風險可接受；
日後若要存分數、排行榜或成就，必須改成一次性憑證（加 jti，提交後記錄已使用）。
"""
import base64
import hashlib
import json
import zlib

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings

TOKEN_TTL_SECONDS = 2 * 60 * 60


def _fernet() -> Fernet:
    digest = hashlib.sha256(f"crossword-puzzle-token:{settings.SECRET_KEY}".encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def issue(uid: str, solution: list, legend: list) -> str:
    payload = json.dumps({"uid": uid, "solution": solution, "legend": legend}, ensure_ascii=False).encode("utf-8")
    return _fernet().encrypt(zlib.compress(payload)).decode("ascii")


def read(token: str, uid: str):
    """回傳 {"solution", "legend"}；憑證被改過、過期、或不是這位使用者的都回 None。"""
    try:
        raw = _fernet().decrypt(token.encode("ascii"), ttl=TOKEN_TTL_SECONDS)
        data = json.loads(zlib.decompress(raw).decode("utf-8"))
    except (InvalidToken, UnicodeError, ValueError, zlib.error):
        return None
    if not isinstance(data, dict) or data.get("uid") != uid:
        return None
    if not isinstance(data.get("solution"), list) or not isinstance(data.get("legend"), list):
        return None
    return {"solution": data["solution"], "legend": data["legend"]}
