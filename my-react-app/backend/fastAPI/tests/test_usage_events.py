"""P5.0 數據分析地基：FastAPI 端 record_event() 的 fire-and-forget 行為
（見 fastAPI/usage_events.py 完整說明）——這裡不打真實 Postgres，用 mock
引擎驗證「呼叫 insert」與「任何失敗都不會往外拋例外」這兩件事；search.py
的整合另外驗證 record_event 真的被呼叫、且參數正確。
"""
from unittest.mock import MagicMock, patch

from sqlalchemy.exc import SQLAlchemyError

from fastAPI import usage_events


def test_record_event_noop_when_engine_not_configured():
    """DATABASE_URL 沒設定時 _engine 是 None——呼叫不應該拋例外，也不應該
    嘗試建立連線。"""
    with patch.object(usage_events, "_engine", None):
        usage_events.record_event("page_view", uid="u1", tribe="tayal", payload={"a": 1})  # 不拋例外即為通過


def test_record_event_executes_insert_with_expected_values():
    mock_conn = MagicMock()
    mock_engine = MagicMock()
    mock_engine.begin.return_value.__enter__.return_value = mock_conn

    with patch.object(usage_events, "_engine", mock_engine):
        usage_events.record_event("dictionary_search", uid="u1", tribe="tayal", payload={"query": "abas"})

    assert mock_conn.execute.called
    (compiled_stmt,), _kwargs = mock_conn.execute.call_args
    compiled = compiled_stmt.compile()
    params = compiled.params
    assert params["event_type"] == "dictionary_search"
    assert params["uid"] == "u1"
    assert params["tribe"] == "tayal"
    assert params["payload"] == {"query": "abas"}
    assert params["created_at"] is not None


def test_record_event_defaults_uid_and_tribe_to_empty_string():
    mock_conn = MagicMock()
    mock_engine = MagicMock()
    mock_engine.begin.return_value.__enter__.return_value = mock_conn

    with patch.object(usage_events, "_engine", mock_engine):
        usage_events.record_event("page_view")

    (compiled_stmt,), _kwargs = mock_conn.execute.call_args
    params = compiled_stmt.compile().params
    assert params["uid"] == ""
    assert params["tribe"] == ""
    assert params["payload"] == {}


def test_record_event_swallows_sqlalchemy_error():
    mock_engine = MagicMock()
    mock_engine.begin.side_effect = SQLAlchemyError("connection refused")

    with patch.object(usage_events, "_engine", mock_engine):
        usage_events.record_event("page_view")  # 不拋例外即為通過


def test_record_event_swallows_unexpected_exception():
    mock_engine = MagicMock()
    mock_engine.begin.side_effect = RuntimeError("something else entirely")

    with patch.object(usage_events, "_engine", mock_engine):
        usage_events.record_event("page_view")  # 不拋例外即為通過
