"""後台「AI 產生情境題草稿」端點（路線圖 #23）。

POST /adminapi/quiz-bank/situations/ai-draft/  {"tribe", "word_ids": [辭典詞條 id…（1~5）], "count": 1~3}

編輯者（CONTENT_EDITORS）挑詞條 → 模型產生題目 → 建成 draft 狀態的情境題，並寫一筆 AiQuizDraft 來源紀錄。
之後和人工建立的題目完全一樣：送審 → 審核者核可才會出現在學生題庫；產生者不能核可自己產生的草稿。
旗標 ai_quiz_draft_enabled 預設關閉（會呼叫付費 LLM）；fail-closed，查不到旗標也視為關閉。
"""
import logging
import sys
import traceback

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from rest_framework import serializers

from AIModel.quiz_draft import MAX_ITEMS, MAX_WORDS, DraftGenerationError, generate_situation_drafts
from AIModel.tools import SqlDictionaryLookup
from config.llm import classify_llm_error, get_llm_client
from config.roles import CONTENT_EDITORS
from config.tribes import TRIBE_IDS, TRIBE_MAP
from core.firebase_auth import require_role

from ._shared import parse_json_body, rate_limited_response, write_audit_log
from .models import AiQuizDraft, FeatureFlag, QuizSituationItem
from .serializers import QuizSituationItemSerializer

logger = logging.getLogger(__name__)

FLAG_KEY = "ai_quiz_draft_enabled"
TARGET_TYPE = "quiz_situation_item"


class AiDraftRequestSerializer(serializers.Serializer):
    tribe = serializers.ChoiceField(choices=sorted(TRIBE_IDS))
    word_ids = serializers.ListField(
        child=serializers.RegexField(r"^[A-Za-z0-9_-]{1,64}$"), min_length=1, max_length=MAX_WORDS)
    count = serializers.IntegerField(min_value=1, max_value=MAX_ITEMS, default=1)


def draft_feature_enabled() -> bool:
    flag = FeatureFlag.objects.filter(key=FLAG_KEY).first()
    return bool(flag is not None and flag.enabled)


@csrf_exempt
def situation_ai_draft(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    if not draft_feature_enabled():
        return JsonResponse({"detail": "AI 產生題目目前尚未開放。", "code": "ai_quiz_draft_disabled"}, status=403)
    limited_resp = rate_limited_response(request, decoded, group="quiz_draft_generate", rate="10/m")
    if limited_resp:
        return limited_resp

    # 月預算超過時 AI 助手總開關會被自動關閉（見 adminapi/ai_budget.py）；後台產生題目也走同一個出口，要一併停
    from AIModel.views import _assistant_disabled_response
    disabled_resp = _assistant_disabled_response()
    if disabled_resp:
        return disabled_resp

    data, err_resp = parse_json_body(request)
    if err_resp:
        return err_resp
    serializer = AiDraftRequestSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
    params = serializer.validated_data
    uid = decoded.get("uid", "anon")
    tribe = params["tribe"]

    try:
        result = generate_situation_drafts(
            get_llm_client(), TRIBE_MAP.get(tribe, "族語"), SqlDictionaryLookup(TRIBE_IDS[tribe]),
            params["word_ids"], params["count"], uid=uid,
        )
    except DraftGenerationError as exc:
        return JsonResponse({"detail": str(exc), "code": "ai_quiz_draft_failed"}, status=422)
    except Exception:
        logger.error("[situation_ai_draft] 產生失敗\n%s", traceback.format_exc())
        status, detail = classify_llm_error(sys.exc_info()[1])
        return JsonResponse({"detail": detail}, status=status)

    created = []
    with transaction.atomic():
        for draft in result["drafts"]:
            item = QuizSituationItem.objects.create(
                tribe=tribe, scenario_chinese=draft["scenario_chinese"], options=draft["options"],
                answer=draft["answer"], created_by=uid,                     # status 預設就是 draft
            )
            AiQuizDraft.objects.create(
                content_type=TARGET_TYPE, content_id=item.pk, tribe=tribe,
                source_word_ids=[e["word_id"] for e in result["entries"]],
                source_words=[e["name"] for e in result["entries"]],
                unverified_words=draft["unverified_words"], model=result["model"], generated_by=uid,
            )
            write_audit_log(
                request, decoded, "ai_generate", item,
                after=QuizSituationItemSerializer(item).data, target_type=TARGET_TYPE,
            )
            created.append(QuizSituationItemSerializer(item).data)
    return JsonResponse({"items": created}, status=201)
