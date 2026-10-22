"""AI 助手結構化輸出的 JSON Schema（output_config.format）。

結構化輸出的 schema 只支援一部分 JSON Schema 關鍵字（每個物件都要
additionalProperties: false，不支援 minItems／pattern 等限制），所以這裡只描述
「形狀」；時間是否有效、end 是否晚於 start、日期範圍這些語意規則由
services.validate_study_plan 在伺服器端驗證。
"""

# 句子補充說明（路線圖 #11）：參考翻譯加上四個分欄。沒有內容的欄位用空字串／空陣列，
# 長度上限由 services.parse_review 在伺服器端限制（schema 不支援 maxLength）。
REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "translation": {"type": "string"},
        "vocab": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"word": {"type": "string"}, "note": {"type": "string"}},
                "required": ["word", "note"],
                "additionalProperties": False,
            },
        },
        "grammar": {"type": "string"},
        "culture": {"type": "string"},
        "pitfalls": {"type": "string"},
    },
    "required": ["translation", "vocab", "grammar", "culture", "pitfalls"],
    "additionalProperties": False,
}

# 單題錯題講解（路線圖 #22）：difference 是「你選了…，正解是…，差別在…」，其餘欄位同句子補充說明。
QUESTION_REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "difference": {"type": "string"},
        "vocab": REVIEW_SCHEMA["properties"]["vocab"],
        "grammar": {"type": "string"},
        "culture": {"type": "string"},
        "pitfalls": {"type": "string"},
    },
    "required": ["difference", "vocab", "grammar", "culture", "pitfalls"],
    "additionalProperties": False,
}

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "events": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string"},
                    "description": {"type": "string"},
                    "start": {"type": "string"},
                    "end": {"type": "string"},
                },
                "required": ["summary", "description", "start", "end"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["title", "events"],
    "additionalProperties": False,
}

# AI 產生情境題草稿（路線圖 #23）：每題一段中文情境、4 個族語對話選項（含中文意思）與正解。
# 題數、選項數、長度與正解範圍由 quiz_draft.parse_situation_drafts 在伺服器端驗證。
QUIZ_DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "scenario_chinese": {"type": "string"},
                    "options": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"foreign": {"type": "string"}, "chinese": {"type": "string"}},
                            "required": ["foreign", "chinese"],
                            "additionalProperties": False,
                        },
                    },
                    "answer": {"type": "integer"},
                },
                "required": ["scenario_chinese", "options", "answer"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["items"],
    "additionalProperties": False,
}
