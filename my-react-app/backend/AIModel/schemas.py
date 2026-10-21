"""AI 助手結構化輸出的 JSON Schema（output_config.format）。

結構化輸出的 schema 只支援一部分 JSON Schema 關鍵字（每個物件都要
additionalProperties: false，不支援 minItems／pattern 等限制），所以這裡只描述
「形狀」；時間是否有效、end 是否晚於 start、日期範圍這些語意規則由
services.validate_study_plan 在伺服器端驗證。
"""

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
