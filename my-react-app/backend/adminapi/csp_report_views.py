"""CSP 違規回報收集端點（稽核 BE5-04）。

nginx 的 Content-Security-Policy-Report-Only 帶 report-uri／report-to 指到這裡，瀏覽器遇到「如果強制執行就會被擋」
的資源時會 POST 一份報告過來。有了這些紀錄，才能在不靠人工逐頁開 Console 的情況下，補齊來源清單、再安心改成強制執行。

匿名端點，所以：只收 POST、本文上限 64KB、依 IP 限流、只記不存資料庫，且網址一律去掉查詢字串與片段
（避免 token 之類的參數寫進日誌）。永遠回 204，不洩漏任何內部資訊。
"""
import json
import logging
import re
from urllib.parse import urlsplit

from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from ._shared import ip_rate_limited_response

logger = logging.getLogger("csp_report")

_MAX_BODY_BYTES = 64 * 1024   # Reporting API 會把多筆報告合成一個 POST，留餘裕
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f]")
_MAX_REPORTS_PER_REQUEST = 10
_FIELDS = ("violated-directive", "effective-directive", "blocked-uri", "document-uri", "source-file", "disposition")


def _clean(value) -> str:
    """網址只留 scheme://host/path；inline、eval、data 這類關鍵字原樣保留。一律截斷。"""
    if not isinstance(value, str):
        return ""
    value = _CONTROL_CHARS.sub("", value.strip()[:500])    # 換行等控制字元不能寫進日誌（避免偽造日誌行）
    parts = urlsplit(value)
    if parts.scheme in ("http", "https", "ws", "wss") and parts.netloc:
        return f"{parts.scheme}://{parts.netloc}{parts.path}"[:200]
    return value.split("?", 1)[0].split("#", 1)[0][:100]


def _normalise(entry) -> dict | None:
    """支援兩種格式：舊的 {"csp-report": {...}}（report-uri）與 Reporting API 的 {"type": "csp-violation", "body": {...}}（report-to）。"""
    if not isinstance(entry, dict):
        return None
    body = entry.get("csp-report") if isinstance(entry.get("csp-report"), dict) else entry.get("body")
    if not isinstance(body, dict):
        return None
    camel = {"violated-directive": "violatedDirective", "effective-directive": "effectiveDirective",
             "blocked-uri": "blockedURL", "document-uri": "documentURL", "source-file": "sourceFile",
             "disposition": "disposition"}
    return {field: _clean(body.get(field, body.get(camel[field], ""))) for field in _FIELDS}


@csrf_exempt
@require_POST
def csp_report(request):
    limited = ip_rate_limited_response(request, group="csp_report", rate="30/m", method="POST")
    if limited:
        return limited
    try:
        length = int(request.META.get("CONTENT_LENGTH") or 0)
    except ValueError:
        length = _MAX_BODY_BYTES + 1
    if length > _MAX_BODY_BYTES:
        return JsonResponse({"detail": "報告太大"}, status=413)

    try:
        data = json.loads(request.body[:_MAX_BODY_BYTES])
    except (json.JSONDecodeError, UnicodeDecodeError):
        return HttpResponse(status=204)       # 壞掉的報告不值得回錯誤，也不記錄
    entries = data if isinstance(data, list) else [data]
    for entry in entries[:_MAX_REPORTS_PER_REQUEST]:
        report = _normalise(entry)
        if report and (report["violated-directive"] or report["effective-directive"]):
            logger.warning(
                "CSP 違規 %s 擋下 %s（頁面 %s）",
                report["effective-directive"] or report["violated-directive"], report["blocked-uri"] or "?", report["document-uri"] or "?",
            )
    return HttpResponse(status=204)
