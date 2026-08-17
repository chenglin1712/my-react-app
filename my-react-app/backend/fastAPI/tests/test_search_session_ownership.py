"""_call_with_own_session()：/keys/、/all/、/key/ 這三個端點原本用 FastAPI
依賴注入的 Session（在另一個 context 建立）傳進 asyncio.to_thread() 丟給
worker thread 執行，Session 不是 thread-safe（P4 review BE-20）。修正後改成
在真正執行查詢的 thread 裡自己開一個新 Session、執行完自己關掉。這裡直接
測這個 helper 本身的保證，不需要真的連資料庫——用一個假的 SessionLocal
確認：(1) 每次呼叫都建立自己的 Session、(2) 把它傳給 fn 當第一個參數、
(3) 不管 fn 成功或丟例外都會關閉這個 Session。
"""
from unittest.mock import MagicMock, patch

import pytest

from fastAPI.routes.dictionary.search import _call_with_own_session


def test_creates_and_passes_own_session_to_fn():
    fake_session = MagicMock()
    with patch("fastAPI.routes.dictionary.search.SessionLocal", return_value=fake_session) as mock_factory:
        result = _call_with_own_session(lambda db, x: (db, x * 2), 21)

    mock_factory.assert_called_once()
    assert result == (fake_session, 42)


def test_closes_session_after_successful_call():
    fake_session = MagicMock()
    with patch("fastAPI.routes.dictionary.search.SessionLocal", return_value=fake_session):
        _call_with_own_session(lambda db: "ok")

    fake_session.close.assert_called_once()


def test_closes_session_even_when_fn_raises():
    fake_session = MagicMock()

    def _boom(db):
        raise RuntimeError("query failed")

    with patch("fastAPI.routes.dictionary.search.SessionLocal", return_value=fake_session):
        with pytest.raises(RuntimeError):
            _call_with_own_session(_boom)

    fake_session.close.assert_called_once()


def test_each_call_gets_a_distinct_session():
    """兩次呼叫要是兩個獨立的 Session，不是同一個被重複使用/跨呼叫共用——
    每次呼叫都應該自己新建一個，模擬兩個並行請求各自落在不同 thread 上
    的情境。"""
    sessions_created = [MagicMock(), MagicMock()]
    with patch("fastAPI.routes.dictionary.search.SessionLocal", side_effect=sessions_created):
        result1 = _call_with_own_session(lambda db: db)
        result2 = _call_with_own_session(lambda db: db)

    assert result1 is sessions_created[0]
    assert result2 is sessions_created[1]
    assert result1 is not result2
    sessions_created[0].close.assert_called_once()
    sessions_created[1].close.assert_called_once()
