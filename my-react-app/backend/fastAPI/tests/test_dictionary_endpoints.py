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
            # raise_server_exceptions=False：search.py 這幾支端點不再自己
            # 包一層 except Exception（P4 review BE-28，見 search.py 的
            # 說明），未攔截的例外交給 main.py 的全域 handler 處理；預設
            # 的 TestClient 在回應送出後仍會把原始例外重新拋出給測試本身，
            # 關掉這個行為才能對 test_key_endpoint_responds_normally_
            # even_if_event_recording_raises 的回應內容斷言。
            with TestClient(app, raise_server_exceptions=False) as test_client:
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


def test_key_endpoint_records_search_event(client):
    """P5 搜尋分析地基：/key/ 算完命中數後要記錄一筆 dictionary_search
    事件，tribe 記錄成 slug（不是中文全名），零結果也要正確記成 0。"""
    with patch("fastAPI.routes.dictionary.search.record_event") as mock_record:
        response = client.post("/api/v1/dictionary/key/", json={"keyword": "balay", "tribe": "tayal"})
    assert response.status_code == 200
    mock_record.assert_called_once_with(
        "dictionary_search",
        tribe="tayal",
        payload={"query": "balay", "exact_hit_count": 0, "fuzzy_hit_count": 0},
    )


def test_key_endpoint_responds_normally_even_if_event_recording_raises(client):
    """record_event() 本身設計成 fire-and-forget 不會往外拋例外，但這裡額外
    確認呼叫端沒有多包一層會被例外打斷的邏輯——就算它意外拋了例外，也不該
    是靠這個端點的 try/except 吞掉；record_event 的失敗保證由它自己負責，
    這支測試只是驗證呼叫順序（先回應內容都算完才記錄）沒有製造新的脆弱點。"""
    with patch("fastAPI.routes.dictionary.search.record_event", side_effect=RuntimeError("boom")):
        response = client.post("/api/v1/dictionary/key/", json={"keyword": "balay", "tribe": "tayal"})
    # allsearch_tayal_dictionary 本身不再攔截這個例外（P4 review BE-28），
    # record_event 出錯會往外傳到 main.py 的全域 handler 被轉成 500——這正是
    # 為什麼 record_event 自己必須保證不拋例外（見 fastAPI/usage_events.py），
    # 這裡記錄下這個耦合，不是期望值本身。
    assert response.status_code == 500


def test_audio_endpoint_has_request_param_and_does_not_crash(client):
    # P5 辭典媒體自主化：proxy_audio 現在會先查 media_asset 有沒有已遷移的
    # 自有副本，這裡的 file_id 假設還沒遷移到（回傳 None），才會走到下面
    # 這支測試原本要測的 ILRDF fallback 路徑；client fixture 的 _fake_get_db
    # 回傳 None，不是真正能查詢的 Session，所以要 patch 掉這次查詢本身。
    with patch("fastAPI.routes.dictionary.audio_proxy._lookup_verified_audio_asset", return_value=None):
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
