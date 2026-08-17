"""族語測驗題目／首頁最新消息／考試時程的公開端點。

實際的選題邏輯（P4 review BE-16）在 quiz_bank.py（四個等級 + 情境題怎麼
從已審定題庫抽題），對外爬取邏輯在 exam_site.py（tacp 活動消息／族語認證
公告／考試時程，含共用的官網 HTML 快取）——這個檔案只保留 HTTP 邊界的事：
認證、限流、request 參數解析、JsonResponse 包裝。

get_news_data／apply_exam_schedule_overrides／get_exam_schedule_data 在
這裡重新匯出：adminapi/crawler_sync.py 跟 adminapi/views.py 原本就是
`from crawler.views import X` 直接引用名稱，搬到 exam_site.py 之後這裡
繼續匯出同一個名稱，兩邊呼叫路徑不必更動。
"""
from django.http import JsonResponse
from django_ratelimit.core import is_ratelimited

from core.firebase_auth import verify_firebase_token
from config.tribes import TRIBE_IDS, TRIBE_MAP
from adminapi.rate_limits import get_configured_rate

from . import quiz_bank
from .exam_site import apply_exam_schedule_overrides, get_exam_schedule_data, get_news_data


def _rate_limited_response(request, key, group, rate, method):
    """依 key（已登入使用者 uid 或 IP）限速，邏輯與 AIModel/views.py 一致。"""
    effective_rate = get_configured_rate(group, rate)
    limited = is_ratelimited(
        request, group=group, key=lambda g, r: key,
        rate=effective_rate, method=method, increment=True,
    )
    if limited:
        return JsonResponse({"detail": "請求過於頻繁，請稍後再試"}, status=429)
    return None


def get_situation_quiz_data(request):
    """情境題的獨立出題端點——跟 get_quiz_data 同一套認證/限流標準，
    但刻意不共用同一個 URL/函式：情境題沒有 level 概念，混進
    get_quiz_data 的 level 白名單檢查會讓語意變得混亂（level="5" 看起來
    像是官方認證的第五級，但情境題根本不是那個系統的一部分）。"""
    decoded, err_resp = verify_firebase_token(request)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(
        request, decoded.get("uid", "anon"), group="get_situation_quiz_data", rate="30/m", method="GET"
    )
    if limited_resp:
        return limited_resp

    tribe = request.GET.get("tribe", "tayal")
    if tribe not in TRIBE_IDS:
        return JsonResponse({"detail": f"不支援的族語: {tribe}"}, status=400)

    disabled_resp = quiz_bank._quiz_disabled_response(tribe)
    if disabled_resp:
        return disabled_resp

    display_name = TRIBE_MAP.get(tribe, tribe)
    format_data = {"chapter_name": display_name, "parts": [quiz_bank.build_situation_test_from_db(tribe)]}
    return JsonResponse(format_data, safe=False)


#爬取線上測驗題目——四個等級皆已改用本地題庫（見 quiz_bank.py 的 build_*_from_db 函式），
#不再即時代理外部 API
def get_quiz_data(request):
    # 會對外打第三方 API（無逾時風險）且完全沒有認證/限流保護，可被匿名重複呼叫，
    # 故加上登入 + 限流，與 CrosswordPuzzle.generate_crossword 同標準。
    decoded, err_resp = verify_firebase_token(request)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(
        request, decoded.get("uid", "anon"), group="get_quiz_data", rate="30/m", method="GET"
    )
    if limited_resp:
        return limited_resp

    #取得族語與等級，預設泰雅語/1
    tribe = request.GET.get("tribe", "tayal")
    level = request.GET.get("level", "1")

    if tribe not in TRIBE_IDS:
        return JsonResponse({"detail": f"不支援的族語: {tribe}"}, status=400)
    if level not in ("1", "2", "3", "4"):
        return JsonResponse({"detail": f"不支援的等級: {level}"}, status=400)

    disabled_resp = quiz_bank._quiz_disabled_response(tribe)
    if disabled_resp:
        return disabled_resp

    # 四個等級都已經改讀本地題庫（QuizTrueFalseItem／QuizChoiceItem／
    # QuizVocabItem／QuizClozePassage，見 adminapi/quizbank_views.py），
    # 不再即時代理外部 API（P2.5 遷移，見規劃文件）：中高級/高級是因為對方
    # API 對這兩級一律回傳 null；初級/中級則是因為對方是隨機出題、且長期
    # 依賴第三方網址有穩定性風險，兩種情況都改成「族語老師審定過的內容才
    # 會被抽到」。
    display_name = TRIBE_MAP.get(tribe, tribe)
    level_builders = {
        "1": quiz_bank.build_true_false_test_from_db,
        "2": quiz_bank.build_choice_test_from_db,
        "3": quiz_bank.build_matching_test_from_db,
        "4": quiz_bank.build_cloze_test_from_db,
    }
    format_data = {"chapter_name": display_name, "parts": [level_builders[level](tribe)]}
    return JsonResponse(format_data, safe=False)


def get_tayal_imformation(request):
    """首頁新聞（族語認證最新公告 + tacp 活動消息）公開端點。

    注意：新增「爬蟲內容匯入後台公告」機制（見 adminapi/crawler_sync.py）
    之後，首頁本身已改為只讀 /adminapi/public/announcements/，不再直接打
    這支端點——這支端點刻意保留，供後台「同步爬蟲活動」與直接驗證爬蟲
    目前實際抓到什麼內容使用，不是死代碼。
    """
    # 維持公開（不要求登入），但仍加 IP 限流防止匿名濫用；已有 15 分鐘快取，
    # 即使被打穿限流，實際對外部網站的請求量也有上限。
    client_ip = request.META.get("REMOTE_ADDR", "unknown")
    limited_resp = _rate_limited_response(
        request, client_ip, group="get_tayal_imformation", rate="60/m", method="GET"
    )
    if limited_resp:
        return limited_resp

    data = get_news_data()
    if data is None:
        return JsonResponse({"detail": "最新消息暫時無法取得，請稍後再試"}, status=502)

    return JsonResponse(data, safe=False, json_dumps_params={'ensure_ascii': False, 'indent': 2})


def get_exam_schedule(request):
    # 首頁行事曆維持公開（不要求登入），比照 get_tayal_imformation 加 IP 限流 + 快取。
    client_ip = request.META.get("REMOTE_ADDR", "unknown")
    limited_resp = _rate_limited_response(
        request, client_ip, group="get_exam_schedule", rate="60/m", method="GET"
    )
    if limited_resp:
        return limited_resp

    data = get_exam_schedule_data()

    if data is None:
        # 爬蟲這次失敗，但如果後台有人工鎖定的期程資料，仍然可以只靠覆寫
        # 資料撐住畫面，不用整個 502——這正是「覆寫」這個功能存在的意義：
        # 官網改版讓爬蟲解析不出結果時，後台填過的資料還是能正常顯示。
        override_only = apply_exam_schedule_overrides([])
        if not override_only:
            return JsonResponse({"detail": "考試時程暫時無法取得，請稍後再試"}, status=502)
        fallback = {"source_url": "https://exam.sce.ntnu.edu.tw/abst/", "session": None, "phases": override_only}
        return JsonResponse(fallback, safe=False, json_dumps_params={'ensure_ascii': False, 'indent': 2})

    merged = {**data, "phases": apply_exam_schedule_overrides(data["phases"])}
    return JsonResponse(merged, safe=False, json_dumps_params={'ensure_ascii': False, 'indent': 2})
