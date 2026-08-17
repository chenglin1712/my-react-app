"""DictionaryRevision 核准流程的套用／記帳邏輯，從 dictionary_views.py 抽出來
（P4 review BE-16，Codex 建議這是 5 個 god view 裡風險最集中的一個：跨
dictionary_db／Django 兩個資料庫、稽核紀錄、補償性交易，所以排在最後才拆，
而且刻意只搬移原本就已經是獨立函式的部分，不重新設計
dictionary_revision_approve() 本身的例外處理流程）。

跟角色檢查／限流／request 參數解析這些 HTTP 邊界關注點分開：這裡的函式
吃 revision 物件或 pk，不直接碰 Django HttpRequest（_finalize_approved_revision
例外——它需要 request/decoded 轉呼叫 _safe_write_audit_log，維持跟原本
inline 時一致的簽名，不重新設計呼叫介面）。

reconcile_stuck_dictionary_revisions 管理指令原本就是
`from adminapi.dictionary_views import _CACHE_SCOPES, _TREE_GETTERS,
_revision_target_type`——dictionary_views.py 會把這幾個名稱重新匯入自己的
命名空間，那支管理指令的匯入路徑不必更動。
"""
import json
import time

from django.db import transaction
from django.utils import timezone

from . import dictionary_write as dw
from ._shared import safe_write_audit_log as _safe_write_audit_log
from .dictionary_cache import invalidate_dictionary_cache
from .models import DictionaryRevision


def _revision_target_type(revision):
    """稽核紀錄的 target_type——詞條與文法章節共用同一批送審流程端點（見
    _APPLIERS），不能寫死 "dictionary_word_revision"，否則文法章節的送審/
    核准/退件動作會在稽核日誌裡被誤記成詞條的動作。"""
    return f"dictionary_{revision.target_kind}_revision"


def _apply_word_revision(db, revision):
    """回傳 (result_word_id, result_payload_for_audit)。expected_hash 一律
    傳 revision.base_hash——新建提案這個欄位本來就是空字串，
    apply_word_tree()/delete_word_tree() 只在拿到既有列的鎖之後才會用到它，
    對新建操作沒有影響（見 dictionary_write.py 的併發保護說明）。"""
    if revision.operation == DictionaryRevision.OPERATION_DELETE:
        counts = dw.delete_word_tree(
            db, revision.target_id,
            unlink_references=revision.payload.get("unlink_references", False),
            expected_hash=revision.base_hash,
        )
        return revision.target_id, {"deleted": True, **counts}
    new_id = dw.apply_word_tree(
        db, revision.payload, word_id=revision.target_id or None, expected_hash=revision.base_hash,
    )
    return new_id, dw.get_word_tree(db, new_id)


def _apply_grammar_section_revision(db, revision):
    """回傳 (result_section_id, result_payload_for_audit)。section id 是
    dictionary_db 的 Integer，但 DictionaryRevision.target_id 是 CharField，
    往返時要記得轉型。expected_hash 說明同 _apply_word_revision。"""
    if revision.operation == DictionaryRevision.OPERATION_DELETE:
        dw.delete_grammar_section(db, int(revision.target_id), expected_hash=revision.base_hash)
        return revision.target_id, {"deleted": True}
    section_id = int(revision.target_id) if revision.target_id else None
    new_id = dw.apply_grammar_section(
        db, revision.payload, section_id=section_id, expected_hash=revision.base_hash,
    )
    return str(new_id), dw.get_grammar_section_tree(db, new_id)


# target_kind -> apply 函式。
_APPLIERS = {
    DictionaryRevision.TARGET_WORD: _apply_word_revision,
    DictionaryRevision.TARGET_GRAMMAR_SECTION: _apply_grammar_section_revision,
}

# target_kind -> 核准後要通知 FastAPI 清除的快取 scope。文法章節不清
# grammar_affixes——那個 scope 是給詞綴主檔本身變動用（見 P4.2 的
# dictionary_taxonomy_views.py），章節內容變動不影響詞綴瀏覽端點。
_CACHE_SCOPES = {
    DictionaryRevision.TARGET_WORD: ["words"],
    DictionaryRevision.TARGET_GRAMMAR_SECTION: ["grammar", "grammar_quiz"],
}

# target_kind -> 讀取目前生效內容整棵樹的函式，給核准前的 base_hash
# 併發檢查用（見 dictionary_revision_approve）。target_id 的型別由各自的
# getter 自行處理（詞條是 UUID 字串、文法章節要先轉成 int）。
_TREE_GETTERS = {
    DictionaryRevision.TARGET_WORD: dw.get_word_tree,
    DictionaryRevision.TARGET_GRAMMAR_SECTION: lambda db, target_id: dw.get_grammar_section_tree(db, int(target_id)),
}


def _revert_revision_to_pending_review(pk, error_message):
    """核准流程「認領後才發現套用失敗」時的退回動作——見
    dictionary_revision_approve() 的說明。獨立成函式是因為有兩個失敗點
    （base_hash 在拿到列鎖後仍然不一致、dictionary_db 寫入本身拋錯）需要
    同一套退回邏輯。"""
    with transaction.atomic():
        revision = DictionaryRevision.objects.select_for_update().get(pk=pk)
        revision.status = DictionaryRevision.STATUS_PENDING_REVIEW
        revision.apply_error = error_message
        revision.save(update_fields=["status", "apply_error", "updated_at"])


def _finalize_approved_revision(pk, result_id, result_payload, request, decoded):
    """把「內容已經在 dictionary DB 生效」這件事記到 Django 端：寫
    applied_at／target_id、寫稽核紀錄、通知快取失效。

    寫成幂等函式，可以安全重複呼叫：revision 已經有 applied_at 就直接視為
    完成、原樣回傳（no-op），不會重複寫入稽核紀錄或重複通知快取失效。這讓
    dictionary_revision_approve() 可以在同一個 request 內做幾次短重試，
    reconcile_stuck_dictionary_revisions 管理指令之後也能安全地再呼叫一次
    補完成——不管呼叫幾次，結果都一樣。

    唯一會拋例外往外傳的情況是 Django DB 寫入本身失敗（連線問題、鎖等待
    逾時等）；這時 dictionary DB 那邊的內容已經生效，寫入失敗只代表「這次
    記帳沒寫成功」，呼叫端不應該把 revision 退回 pending_review（那樣下次
    核准會對同一個 target 重新套用一次，可能重複建立或跟已生效內容打架）。
    """
    with transaction.atomic():
        revision = DictionaryRevision.objects.select_for_update().get(pk=pk)
        if revision.applied_at is None:
            revision.applied_at = timezone.now()
            if revision.operation == DictionaryRevision.OPERATION_CREATE:
                revision.target_id = result_id
            revision.save(update_fields=["applied_at", "target_id", "updated_at"])
            _safe_write_audit_log(
                request, decoded, "approve_proposal", result_id or f"revision:{pk}",
                after=json.loads(json.dumps(result_payload, default=str)),
                target_type=_revision_target_type(revision),
            )
    # 快取失效通知一律再嘗試一次，就算上面判斷「已經完成過」也一樣——
    # invalidate_dictionary_cache() 本身是 best-effort、不會拋例外，重複呼叫
    # 也是安全的，這樣如果上一次唯獨這一步沒通知成功，這裡還有機會補上。
    invalidate_dictionary_cache(
        _CACHE_SCOPES.get(revision.target_kind, ["all"]),
        tribes=[revision.tribe] if revision.tribe else None,
    )
    return revision


def _finalize_approved_revision_with_retry(pk, result_id, result_payload, request, decoded,
                                            retries=3, retry_delay_seconds=0.2):
    """finalize 失敗通常是暫時性的 DB 問題（連線瞬斷、鎖等待逾時），值得在
    同一個 request 內短暫重試幾次；不用長 backoff 卡住 worker——長時間故障
    交給 reconcile_stuck_dictionary_revisions 管理指令事後處理，不該讓一個
    HTTP request 硬撐到那種程度。"""
    last_exc = None
    for attempt in range(retries):
        try:
            return _finalize_approved_revision(pk, result_id, result_payload, request, decoded)
        except Exception as exc:
            last_exc = exc
            if attempt < retries - 1:
                time.sleep(retry_delay_seconds)
    raise last_exc
