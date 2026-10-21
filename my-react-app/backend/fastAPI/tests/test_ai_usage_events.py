"""fastAPI/ai_usage_events.py：翻譯呼叫 Anthropic 後的用量寫入（fire-and-forget）。"""
from unittest.mock import MagicMock, patch

from fastAPI import ai_usage_events

ENTRY = {
    "feature": "translate", "uid": "u1", "model": "claude-sonnet-5", "status": "ok", "request_id": "req_1",
    "input_tokens": 100, "output_tokens": 20, "cache_read_tokens": None, "cache_write_tokens": None,
    "latency_ms": 1234,
}


def test_without_a_database_engine_it_silently_skips():
    with patch.object(ai_usage_events, "_engine", None):
        assert ai_usage_events.record_ai_usage(ENTRY) is None


def test_inserts_one_row_with_missing_tokens_as_zero():
    engine = MagicMock()
    conn = engine.begin.return_value.__enter__.return_value
    with patch.object(ai_usage_events, "_engine", engine):
        ai_usage_events.record_ai_usage(ENTRY)

    conn.execute.assert_called_once()
    values = conn.execute.call_args[0][0].compile().params
    assert values["feature"] == "translate"
    assert values["input_tokens"] == 100
    assert values["cache_read_tokens"] == 0
    assert values["cache_write_tokens"] == 0
    assert values["latency_ms"] == 1234


def test_database_errors_never_propagate():
    engine = MagicMock()
    engine.begin.side_effect = RuntimeError("db down")
    with patch.object(ai_usage_events, "_engine", engine):
        assert ai_usage_events.record_ai_usage(ENTRY) is None


def test_columns_match_the_django_model():
    """Django 的 AiUsageLog 欄位一旦異動，這裡手動組的 Table 定義要同步更新。"""
    from sqlalchemy import Column  # noqa: F401
    django_fields = {
        "created_at", "feature", "uid", "model", "status", "request_id",
        "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "latency_ms",
    }
    assert {c.name for c in ai_usage_events._ai_usage_table.columns} == django_fields


def test_main_registers_the_recorder():
    from config import llm
    from fastAPI import main  # noqa: F401  匯入即註冊

    assert llm._usage_recorder is ai_usage_events.record_ai_usage
