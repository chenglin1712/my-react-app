"""詞素學習研究資料（QuizSkillEvent、QuizResearchConsent）的清除：依使用者（撤回、刪除帳號）與依保存期限。

事件只存假名（見 config/quiz_research.py），所以要由 uid 反推假名才刪得到；鹽（QUIZ_RESEARCH_SALT）沒設定時
算不出假名，這時 FastAPI 端本來就不會記錄事件，回報 skipped 而不是假裝刪了。
"""
from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from adminapi.models import QuizResearchConsent, QuizSkillEvent
from config import quiz_research as QR


def purge_user(uid: str) -> dict:
    """刪除這位使用者的全部研究事件，並把同意紀錄標記為已撤回（紀錄本身保留，證明曾經同意與撤回時間）。"""
    pseud = QR.pseudonym(uid)
    if pseud is None:
        return {"skipped": "未設定 QUIZ_RESEARCH_SALT，無法對應假名"}
    # 單一交易、鎖住同意列、【先撤回再刪事件】：FastAPI 端寫事件時同樣鎖這一列並重新檢查是否已撤回，
    # 所以不會有事件在這個清除之後才寫進來（Postgres 的列鎖；SQLite 沒有列鎖，測試只驗證結果）。
    with transaction.atomic():
        list(QuizResearchConsent.objects.select_for_update().filter(pseudonym=pseud))
        revoked = QuizResearchConsent.objects.filter(pseudonym=pseud, revoked_at__isnull=True).update(revoked_at=timezone.now())
        deleted, _ = QuizSkillEvent.objects.filter(pseudonym=pseud).delete()
    return {"events_deleted": deleted, "consent_revoked": revoked}


def purge_older_than(days: int) -> int:
    """刪除超過保存期限（天）的事件，回傳刪除筆數。"""
    if days < 1:
        raise ValueError("days 必須 >= 1")
    deleted, _ = QuizSkillEvent.objects.filter(occurred_at__lt=timezone.now() - timedelta(days=days)).delete()
    return deleted
