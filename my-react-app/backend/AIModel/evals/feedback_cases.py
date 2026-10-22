"""把管理者標成「加入評測題組」的倒讚回饋轉成評測題（路線圖 #30）。

只重現「管理者審過的那一句問題」（標成候選時填寫，預設帶入學生原文讓管理者去掉個資再送出）：回饋只存單則問答，不存前面的對話，所以需要上下文的提問重跑時可能和當時不同，
這類案例請管理者在備註寫清楚期望的答案方向，或改寫成 cases.json 的正式題目。
評審標準依倒讚原因產生；管理者的備註是可信內容（只有 owner／admin 能寫），學生的問題文字照常當作不可信資料。
族語正確性的標準答案仍只能來自辭典：備註只描述期望的行為，不當作族語標準答案。
"""
_CRITERIA = {
    "wrong_tribal": "學生回報上一次的回覆有族語錯誤。回答只能引用辭典查得到的族語，查不到就明說不確定，不可自行編造或猜測拼法與意思。",
    "irrelevant": "學生回報上一次的回覆答非所問。回答要直接回應問題；若問題與族語學習無關，簡短說明並把話題帶回族語學習。",
    "too_hard": "學生回報上一次的回覆太難懂。回答要用簡單、口語的中文，一次只講一個重點，避免專有名詞。",
    "too_long": "學生回報上一次的回覆太長。回答要簡短（約 100 字內），先給結論。",
    "other": "學生對上一次的回覆不滿意。回答要正確、簡短、直接回應問題。",
}


def _checks_for(reason: str) -> list[dict]:
    if reason == "too_long":
        return [{"type": "max_chars", "value": 300}]
    if reason == "wrong_tribal":
        return [{"type": "no_unverified"}]
    return []


def build_feedback_case(row) -> dict:
    """row 是 AiFeedback。回傳符合 cases.validate_case 的題目（id 為 fb-<pk>）。"""
    criteria = _CRITERIA.get(row.reason, _CRITERIA["other"])
    if row.eval_note:
        criteria += f" 管理者備註：{row.eval_note}"
    return {
        "id": f"fb-{row.pk}",
        "category": "feedback",
        "message": row.eval_question,       # 管理者審過的版本，不用學生原文
        "checks": _checks_for(row.reason),
        "judge": criteria,
    }


def load_feedback_cases() -> list[dict]:
    from adminapi.models import AiFeedback

    return [build_feedback_case(r) for r in AiFeedback.objects.filter(eval_candidate=True).exclude(eval_question="").order_by("pk")]
