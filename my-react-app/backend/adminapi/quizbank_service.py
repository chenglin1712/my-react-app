"""給 crawler app 讀取題庫內容用的 domain service，不暴露 adminapi 的 ORM/
model 細節（P4 review BE-8）。

crawler/views.py 組測驗 part 資料時，只需要「這個族語目前已審定通過
（status=published）的題目有哪些」，不需要知道 QuizVocabItem／
QuizClozePassage／QuizTrueFalseItem／QuizChoiceItem／QuizSituationItem 這幾個
model 存在、不需要知道 STATUS_PUBLISHED 這個常數屬於哪個 model、更不需要
一份可以 .save() 的 QuerySet。這裡每個函式只做兩件事——查 status=published、
轉成 immutable DTO——選題邏輯（配額抽樣、隨機排序、組成前端要的題目形狀）
留在 crawler/views.py：那是測驗生成策略，不是題庫資料存取，硬塞進這裡只會
讓這個 service 變成 crawler 專屬的第二個 views.py。

同理，之所以不直接把這幾個 model 搬到獨立的 quizbank app（原始 review 建議
的完整版）：全部都已經跑過 migration、可能已經有真實審定過的題庫資料，搬
app_label 涉及 ContentType／migration dependency graph／db_table 保留等
風險，不是今天要在可能有真實資料的系統上做的等級（見 review 報告 BE-8 的
風險評估），這裡先解決「外部 app 直接依賴 adminapi 內部 schema」這個實際
耦合問題，model 真正搬家留給有資料庫備份與 migration 演練的獨立任務。
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class VocabItem:
    id: int
    chinese_gloss: str
    foreign_word: str
    audio_file_id: str


def get_published_vocab_items(tribe: str, category: str) -> list[VocabItem]:
    from .models import QuizVocabItem

    qs = QuizVocabItem.objects.filter(tribe=tribe, category=category, status=QuizVocabItem.STATUS_PUBLISHED)
    return [
        VocabItem(id=item.id, chinese_gloss=item.chinese_gloss,
                  foreign_word=item.foreign_word, audio_file_id=item.audio_file_id)
        for item in qs
    ]


@dataclass(frozen=True)
class ClozePassage:
    id: int
    passage_foreign: str
    passage_chinese: str
    blanks: dict  # {blank_key: {"options": [...], "answer": int}}，形狀見 QuizClozePassage.blanks


def get_published_cloze_passages(tribe: str) -> list[ClozePassage]:
    from .models import QuizClozePassage

    qs = QuizClozePassage.objects.filter(tribe=tribe, status=QuizClozePassage.STATUS_PUBLISHED)
    return [
        ClozePassage(id=p.id, passage_foreign=p.passage_foreign, passage_chinese=p.passage_chinese, blanks=p.blanks)
        for p in qs
    ]


@dataclass(frozen=True)
class TrueFalseItem:
    id: int
    question_ab: str
    question_ch: str
    audio_url: str
    image_url: str
    answer: int


def get_published_true_false_items(tribe: str) -> list[TrueFalseItem]:
    from .models import QuizTrueFalseItem

    qs = QuizTrueFalseItem.objects.filter(tribe=tribe, status=QuizTrueFalseItem.STATUS_PUBLISHED)
    return [
        TrueFalseItem(id=item.id, question_ab=item.question_ab, question_ch=item.question_ch,
                      audio_url=item.audio_url, image_url=item.image_url, answer=item.answer)
        for item in qs
    ]


@dataclass(frozen=True)
class ChoiceItem:
    id: int
    question_ab: str
    question_ch: str
    image_a_url: str
    image_b_url: str
    image_c_url: str
    answer: int


def get_published_choice_items(tribe: str) -> list[ChoiceItem]:
    from .models import QuizChoiceItem

    qs = QuizChoiceItem.objects.filter(tribe=tribe, status=QuizChoiceItem.STATUS_PUBLISHED)
    return [
        ChoiceItem(id=item.id, question_ab=item.question_ab, question_ch=item.question_ch,
                   image_a_url=item.image_a_url, image_b_url=item.image_b_url, image_c_url=item.image_c_url,
                   answer=item.answer)
        for item in qs
    ]


@dataclass(frozen=True)
class SituationItem:
    id: int
    scenario_chinese: str
    options: list
    answer: int


def get_published_situation_items(tribe: str) -> list[SituationItem]:
    from .models import QuizSituationItem

    qs = QuizSituationItem.objects.filter(tribe=tribe, status=QuizSituationItem.STATUS_PUBLISHED)
    return [
        SituationItem(id=item.id, scenario_chinese=item.scenario_chinese, options=item.options, answer=item.answer)
        for item in qs
    ]


def is_quiz_enabled(tribe: str) -> bool:
    """族語測驗總開關（見 adminapi.models.FeatureFlag）。找不到對應紀錄時
    視為未關閉——維持 crawler/views.py 原本 _quiz_disabled_response() 的
    既有行為（見 seed_feature_flags 管理指令的說明）。"""
    from .models import FeatureFlag

    flag = FeatureFlag.objects.filter(key=f"quiz_enabled_{tribe}").first()
    return flag is None or flag.enabled
