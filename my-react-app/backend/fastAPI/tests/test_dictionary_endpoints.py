"""端到端測試（用 TestClient 真的打 HTTP，不是直接呼叫函式）：這波稽核發現
/key/ 的請求 body 參數原本命名成 request（型別是 KeywordRequest），跟 slowapi
的 @limiter.limit() 用參數「名稱」（不是型別）找 Request 物件的機制衝突——
slowapi 在裝飾時只檢查有沒有一個叫 request 的參數，實際呼叫時才用
isinstance(request, Request) 檢查型別，若直接對這個舊簽名加 @limiter.limit()，
每一次呼叫都會在這裡丟例外。修正時把 body 參數改名、另外加一個真正的
request: Request，這裡直接用 TestClient 驗證整條路徑不會噴例外。

/audio/{file_id} 原本完全沒有 Request 參數，同樣需要先補上才能加限流。

用 fastAPI.routes.dictionary.search._load_tribe_words 直接回傳假資料，避免依賴
本機是否真的有那個 71MB、被 .gitignore 排除的 dictionary.db（CI 環境不會有）。
"""
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from fastAPI.main import app
from fastAPI.routes import auth as auth_module
from dictionary_db.connect import get_db


def _fake_get_db():
    yield None


async def _fake_auth():
    return {"uid": "test-user"}


@pytest.fixture
def client():
    app.dependency_overrides[get_db] = _fake_get_db
    app.dependency_overrides[auth_module.verify_firebase_token] = _fake_auth
    try:
        with patch("fastAPI.routes.dictionary.search._load_tribe_words", return_value=[]):
            with TestClient(app) as test_client:
                yield test_client
    finally:
        app.dependency_overrides.clear()


def test_key_endpoint_does_not_crash_on_rate_limiter_request_lookup(client):
    # 修正前：這一個呼叫就會因為 slowapi 對「假 request 參數」做 isinstance
    # 檢查失敗而丟例外，這裡確認現在會正常回應而不是 500/例外。
    response = client.post("/api/v1/dictionary/key/", json={"keyword": "balay", "tribe": "tayal"})
    assert response.status_code == 200
    assert response.json() == {
        "exact_match_results": {"balay": []},
        "fuzzy_match_results": {"balay": {}},
    }


def test_key_endpoint_rejects_empty_keyword(client):
    response = client.post("/api/v1/dictionary/key/", json={"keyword": "   ", "tribe": "tayal"})
    assert response.status_code == 400


def test_audio_endpoint_has_request_param_and_does_not_crash(client):
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = httpx.Response(status_code=404, request=httpx.Request("GET", "http://x"))
        response = client.get("/api/v1/dictionary/audio/some-file-id")
    assert response.status_code == 404


# 回歸測試：修正前 /key/、/keys/、/all/ 用 TRIBE_MAP.get(tribe, 某個預設值) 解析
# tribe 參數，不支援的值會靜默 fallback 成泰雅語並回傳 200 與看似正常、實則錯
# 部落的真實資料，而不是像 listening.py／sentence.py／quiz.py 一樣回 400。
def test_key_endpoint_rejects_unsupported_tribe(client):
    response = client.post(
        "/api/v1/dictionary/key/", json={"keyword": "balay", "tribe": "這不是一個族語"}
    )
    assert response.status_code == 400


def test_keys_endpoint_rejects_unsupported_tribe(client):
    response = client.post(
        "/api/v1/dictionary/keys/", json={"words": ["balay"], "tribe": "這不是一個族語"}
    )
    assert response.status_code == 400


def test_all_endpoint_rejects_unsupported_tribe(client):
    response = client.post(
        "/api/v1/dictionary/all/", json={"tribe": "這不是一個族語"}
    )
    assert response.status_code == 400
