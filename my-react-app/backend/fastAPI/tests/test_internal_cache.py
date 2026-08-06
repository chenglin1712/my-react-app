"""POST /internal/cache/invalidate（見 routes/internal.py 完整說明）：
P4 辭典管理寫入辭典 DB 後，Django 呼叫這個端點通知 FastAPI 清除已經
算好的辭典/文法快取。用 TestClient 真的打 HTTP，不直接呼叫函式，確保
共用密鑰驗證、scope/tribe 驗證這些邊界情況真的接在路由上。
"""
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from fastAPI.main import app
from fastAPI.routes.dictionary import grammar, search


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def _stub_rewarm_query():
    """任何 scope=words 且真的有東西被清除的測試都會觸發背景重新預熱執行緒
    （見 internal.py 的 _rewarm），該執行緒會呼叫真正的 SessionLocal()／
    _load_tribe_words() 打真實的 dictionary_db。CI 環境不一定有這個 71MB、
    被 .gitignore 排除的資料庫，且測試不該依賴/拖慢在真實資料上跑查詢——
    全部測試預設 stub 掉，只有明確要驗證「有沒有排程重新預熱」的測試
    才另外用同步的 _SyncThread 攔截並確認呼叫參數。"""
    with patch("fastAPI.routes.dictionary.search._load_tribe_words", return_value=[]), \
         patch("fastAPI.routes.internal.SessionLocal", return_value=MagicMock()):
        yield


@pytest.fixture(autouse=True)
def _reset_caches():
    """辭典/文法快取是模組全域，不會隨測試函式自動重置。"""
    search._tribe_words_cache.clear()
    grammar._grammar_cache.clear()
    grammar._grammar_affixes_cache.clear()
    grammar._grammar_quiz_cache.clear()
    yield
    search._tribe_words_cache.clear()
    grammar._grammar_cache.clear()
    grammar._grammar_affixes_cache.clear()
    grammar._grammar_quiz_cache.clear()


def test_missing_secret_env_returns_503(client, monkeypatch):
    monkeypatch.delenv("INTERNAL_API_SECRET", raising=False)

    resp = client.post(
        "/internal/cache/invalidate",
        json={"scopes": ["words"], "tribes": ["tayal"]},
        headers={"X-Internal-Secret": "whatever"},
    )

    assert resp.status_code == 503


def test_missing_header_returns_401(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", "correct-secret")

    resp = client.post(
        "/internal/cache/invalidate",
        json={"scopes": ["words"], "tribes": ["tayal"]},
    )

    assert resp.status_code == 401


def test_wrong_secret_returns_401(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", "correct-secret")

    resp = client.post(
        "/internal/cache/invalidate",
        json={"scopes": ["words"], "tribes": ["tayal"]},
        headers={"X-Internal-Secret": "wrong-secret"},
    )

    assert resp.status_code == 401


def test_unknown_scope_returns_400(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", "correct-secret")

    resp = client.post(
        "/internal/cache/invalidate",
        json={"scopes": ["not_a_real_scope"], "tribes": ["tayal"]},
        headers={"X-Internal-Secret": "correct-secret"},
    )

    assert resp.status_code == 400


def test_unknown_tribe_returns_400(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", "correct-secret")

    resp = client.post(
        "/internal/cache/invalidate",
        json={"scopes": ["words"], "tribes": ["not-a-real-tribe"]},
        headers={"X-Internal-Secret": "correct-secret"},
    )

    assert resp.status_code == 400


def test_correct_secret_invalidates_warmed_cache_key(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", "correct-secret")

    # 先暖一個 key，確認 invalidate 之後這個 key 真的不見了（不是只回 200 沒有效果）。
    search._tribe_words_cache.get_or_compute("泰雅語", lambda: ["fake-word"])
    assert "泰雅語" in search._tribe_words_cache

    # _rewarm 是背景執行緒非同步啟動的，直接 patch 它本體會有競態（斷言可能
    # 在執行緒真的跑之前就先執行）；改成攔截 threading.Thread 本身，同步呼叫
    # 被包起來的 target 並記錄呼叫參數，確定真的有被排程執行。
    started_with = []

    class _SyncThread:
        def __init__(self, target, args=(), daemon=None):
            started_with.append(args)
            target(*args)

        def start(self):
            pass

    with patch("fastAPI.routes.internal.threading.Thread", _SyncThread):
        resp = client.post(
            "/internal/cache/invalidate",
            json={"scopes": ["words"], "tribes": ["tayal"]},
            headers={"X-Internal-Secret": "correct-secret"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["invalidated"]["words"] == 1
    assert "泰雅語" not in search._tribe_words_cache
    assert started_with == [(["泰雅語"],)]


def test_scope_all_invalidates_every_cache(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", "correct-secret")

    search._tribe_words_cache.get_or_compute("泰雅語", lambda: ["fake-word"])
    grammar._grammar_cache.get_or_compute("泰雅語", lambda: {"sections": []})
    grammar._grammar_quiz_cache.get_or_compute("泰雅語", lambda: {"sections": []})
    grammar._grammar_affixes_cache.get_or_compute(("泰雅語", ""), lambda: {"affixes": []})

    resp = client.post(
        "/internal/cache/invalidate",
        json={"scopes": ["all"], "tribes": ["tayal"]},
        headers={"X-Internal-Secret": "correct-secret"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["invalidated"] == {
        "words": 1, "grammar": 1, "grammar_affixes": 1, "grammar_quiz": 1,
    }


def test_grammar_affixes_scope_only_clears_matching_tribe(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", "correct-secret")

    grammar._grammar_affixes_cache.get_or_compute(("泰雅語", ""), lambda: {"affixes": []})
    grammar._grammar_affixes_cache.get_or_compute(("阿美語", ""), lambda: {"affixes": []})

    resp = client.post(
        "/internal/cache/invalidate",
        json={"scopes": ["grammar_affixes"], "tribes": ["tayal"]},
        headers={"X-Internal-Secret": "correct-secret"},
    )

    assert resp.status_code == 200
    assert resp.json()["invalidated"]["grammar_affixes"] == 1
    assert ("泰雅語", "") not in grammar._grammar_affixes_cache.keys()
    assert ("阿美語", "") in grammar._grammar_affixes_cache.keys()


def test_omitted_tribes_targets_all_tribes(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", "correct-secret")

    search._tribe_words_cache.get_or_compute("泰雅語", lambda: ["a"])
    search._tribe_words_cache.get_or_compute("阿美語", lambda: ["b"])

    resp = client.post(
        "/internal/cache/invalidate",
        json={"scopes": ["words"]},
        headers={"X-Internal-Secret": "correct-secret"},
    )

    assert resp.status_code == 200
    assert resp.json()["invalidated"]["words"] == 2


def test_no_words_invalidated_skips_rewarm(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", "correct-secret")

    with patch("threading.Thread") as mock_thread:
        resp = client.post(
            "/internal/cache/invalidate",
            json={"scopes": ["grammar"], "tribes": ["tayal"]},
            headers={"X-Internal-Secret": "correct-secret"},
        )

    assert resp.status_code == 200
    assert resp.json()["rewarm"] == "skipped"
    mock_thread.assert_not_called()
