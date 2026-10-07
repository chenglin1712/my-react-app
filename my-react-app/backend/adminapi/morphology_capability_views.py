"""系統維運「形態分析能力」頁的唯讀端點：GET /adminapi/system/morphology-capabilities/。

回傳 report_morphology_capabilities 指令同一份報表（config/morphology_reporting.py 的凍結定義），不寫資料庫、
不寫放行檔、不影響執行期。權限：所有後台角色可看（STAFF_ROLES）。

報表要載入五個族語的整份辭典（數秒），所以：
- 結果在【單一程序內】快取約 TTL 秒（從計算完成起算）；多個 gunicorn worker 各有自己的快取與鎖，所以
  最壞情況每個 worker 各算一次——這是唯讀、低頻的後台頁，可以接受，不為它引入跨程序快取。
- 快取過期時用鎖做程序內的 single-flight，同時進來的請求只會有一個真的去算，其他等它的結果；
  等待鎖有逾時（LOCK_TIMEOUT_SECONDS），資料庫卡住時請求會回 503 而不是無限期堆積。
- 計算失敗回 503 與固定訊息（不外洩例外內容、不回傳舊快取假裝正常），下一次請求會重新計算。
- 回應包一層 generated_at／cached；報表本體（report）只依資料決定，不含時間。
"""
import logging
import threading
import time
from datetime import datetime, timezone

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from adminapi.management.commands.report_morphology_capabilities import build
from config.roles import STAFF_ROLES
from core.firebase_auth import require_role
from dictionary_db.connect import SessionLocal
from fastAPI.routes.translation.morph import ARTIFACT_PATH

from ._shared import rate_limited_response as _rate_limited_response

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 60
LOCK_TIMEOUT_SECONDS = 30

_lock = threading.Lock()
_cached: dict = {"at": None, "generated_at": None, "report": None}


def clear_cache() -> None:
    with _lock:
        _cached.update(at=None, generated_at=None, report=None)   # 連同舊報表一起丟掉，不只是讓它過期


def _compute() -> dict:
    db = SessionLocal()
    try:
        return build(db, ARTIFACT_PATH)
    finally:
        db.close()


def _get_report() -> tuple[dict, str, bool]:
    """(報表, generated_at, 是否來自快取)；算失敗就丟例外，由呼叫端轉成 503。"""
    # 持鎖計算：同時進來的請求排隊等同一次計算，而不是各算一次；等太久就放棄（呼叫端轉 503）
    if not _lock.acquire(timeout=LOCK_TIMEOUT_SECONDS):
        raise TimeoutError("等待形態分析能力報表的計算逾時")
    try:
        at = _cached["at"]
        if at is not None and time.monotonic() - at < CACHE_TTL_SECONDS:
            return _cached["report"], _cached["generated_at"], True
        report = _compute()
        generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        _cached.update(at=time.monotonic(), generated_at=generated_at, report=report)
        return report, generated_at, False
    finally:
        _lock.release()


@csrf_exempt
def morphology_capabilities(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="morphology_capabilities", rate="30/m", method="GET")
    if limited_resp:
        return limited_resp
    try:
        report, generated_at, cached = _get_report()
    except Exception:
        logger.exception("morphology capability report failed")
        return JsonResponse({"detail": "目前無法產生形態分析能力報表，請稍後再試"}, status=503)
    return JsonResponse({
        "report": report, "generated_at": generated_at, "cached": cached, "cache_ttl_seconds": CACHE_TTL_SECONDS,
    })
