"""一位使用者的個人資料存放在哪些 Firestore 位置（稽核 BE2a-01／02）。

匯出（user_export）與刪除帳號（user_delete）都迭代這同一份清單，所以日後新增個人資料集合時，只要在這裡加一行，
匯出與刪除就會一起涵蓋，不會再發生「匯出有、刪除漏」或反過來的不一致。

種類（kind）：
- query：頂層集合，以某個欄位等於 uid 查出（例如 sharedNotes.uid、situations.userId）。
- subcollection：users/{uid}/<collection> 子集合（刪除 users 文件不會連帶刪除子集合）。
- document：頂層集合裡文件 ID 就是 uid（例如 calendar/{uid}）。
- group_query：collection group 查詢（發音錄音在 pronunciations/{tribe}/recordings，刪除時另外要清 Storage）。
- anonymize：這份資料不屬於本人、不能刪（例如他提出的檢舉紀錄是審核者的工作資料），刪除帳號時只把識別欄位匿名化。
"""
from dataclasses import dataclass

DELETED_USER_PLACEHOLDER = "deleted-user"


@dataclass(frozen=True)
class Location:
    key: str
    label: str
    kind: str
    collection: str = ""
    field: str = ""


LOCATIONS = (
    Location("shared_notes", "分享筆記", "query", "sharedNotes", "uid"),
    Location("pronunciations", "發音錄音", "group_query", "recordings", "uid"),
    Location("cloud_notes", "雲端筆記", "subcollection", "notes"),
    Location("note_index", "雲端筆記索引", "subcollection", "noteIndex"),
    Location("quiz_rule_state", "詞素學習的規則熟練度", "subcollection", "quizRuleState"),
    Location("ai_asked_questions", "AI 助手題目紀錄", "subcollection", "aiAskedQuestions"),
    Location("study_plans", "追蹤中的讀書計畫", "subcollection", "studyPlans"),
    Location("weekly_digest", "每週學習摘要", "subcollection", "weeklyDigest"),
    Location("calendar", "個人行事曆", "document", "calendar"),
    Location("situations", "答題紀錄", "query", "situations", "userId"),
    Location("user_situation", "學習統計", "query", "userSituation", "userId"),
    Location("quizs", "測驗題目紀錄", "query", "quizs", "userId"),
    Location("reports", "提出的檢舉", "anonymize", "reports", "reporterUid"),
)


def find_docs(client, uid, location):
    """回傳這個位置下屬於 uid 的文件（DocumentSnapshot list）。"""
    if location.kind == "query":
        return list(client.collection(location.collection).where(location.field, "==", uid).stream())
    if location.kind == "anonymize":
        return list(client.collection(location.collection).where(location.field, "==", uid).stream())
    if location.kind == "group_query":
        return list(client.collection_group(location.collection).where(location.field, "==", uid).stream())
    if location.kind == "subcollection":
        return list(client.collection("users").document(uid).collection(location.collection).stream())
    if location.kind == "document":
        snapshot = client.collection(location.collection).document(uid).get()
        return [snapshot] if snapshot.exists else []
    raise ValueError(f"未知的種類：{location.kind}")


def export_docs(client, uid):
    """{key: [{"id", "path", ...欄位}, ...]}。單一位置讀取失敗只標記該位置，不讓整份匯出失敗。"""
    exported = {}
    for location in LOCATIONS:
        try:
            exported[location.key] = [
                {"id": doc.id, "path": doc.reference.path, **(doc.to_dict() or {})}
                for doc in find_docs(client, uid, location)
            ]
        except Exception:
            import logging
            logging.getLogger(__name__).exception("匯出使用者 %s 的「%s」失敗", uid, location.label)
            exported[location.key] = {"error": "讀取失敗，需人工複查"}
    return exported
