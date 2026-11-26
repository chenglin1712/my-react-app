"""稽核 FE3-01／FE3-02／FE3-04：辭典唯讀查詢對訪客開放、查詢正規化、建議端點。

用 TestClient 真的打 HTTP；_load_tribe_words 換成假資料（CI 沒有辭典資料庫）。
AUTH_DEV_BYPASS 在 CI 是 True，這裡一律關掉，才測得到「沒登入」與「帶 token」兩條真實路徑。
"""
import unicodedata
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from fastAPI.main import app
from fastAPI.rate_limit import limiter
from fastAPI.routes import auth as auth_module
from fastAPI.routes.dictionary import ExplanationItem, SentenceItem, WordResult
from fastAPI.routes.dictionary import search as S
from fastAPI.routes.dictionary.normalize import search_key


def _w(i, name, gloss="真的"):
    return WordResult(
        id=f"w{i}", tribeId="t1", tribe="泰雅語", name=name, frequency=100,
        explanationItems=[ExplanationItem(chineseExplanation=gloss, sentenceItems=[SentenceItem(originalSentence="x")])],
    )


WORDS = [
    _w(1, "balay", "真的"),
    _w(2, "balay2", "真的2"),
    _w(3, "'aring", "開始"),
    _w(4, "caf\u00e9", "咖啡"),            # 預組字 é
    _w(5, "n\u0332ga", "底線字"),          # 字母＋組合底線（U+0332 沒有預組字）
    _w(6, "nga", "沒底線"),
    _w(7, "Yaya", "母親"),
    _w(8, "kbalay", "做好"),
]

# 辭典詞條回應允許出現的欄位：全部是辭典公開資料。之後若在 WordResult 加欄位，這個測試會提醒先確認能不能給訪客看。
PUBLIC_WORD_FIELDS = {
    "id", "tribeId", "tribe", "dialect", "name", "pinyin", "variant", "formationWord", "derivativeRoot",
    "frequency", "hit", "dictionaryNote", "sources", "explanationItems", "audioItems", "word_img",
    "isDerivativeRoot", "isImage", "isZuzucidian", "isOtherDialect",
}


@pytest.fixture
def words():
    return list(WORDS)


@pytest.fixture
def client(monkeypatch, words):
    monkeypatch.setattr(auth_module, "_auth_dev_bypass", lambda: False)
    S._tribe_index_cache.clear()
    limiter.reset()
    with patch.object(S, "_load_tribe_words", return_value=words), \
         patch("fastAPI.routes.dictionary.search.record_event") as record:
        with TestClient(app, raise_server_exceptions=False) as test_client:
            test_client.record_event = record
            yield test_client
    limiter.reset()
    S._tribe_index_cache.clear()


@pytest.fixture
def logged_in(monkeypatch):
    async def fake_verify(request, authorization=None):
        if authorization != "Bearer good":
            raise HTTPException(status_code=401, detail="身份驗證失敗，請重新登入")
        user = {"uid": "member-1"}
        request.state.user = user
        return user
    monkeypatch.setattr(auth_module, "verify_firebase_token", fake_verify)
    return {"Authorization": "Bearer good"}


# ---------------- FE3-01：訪客開放範圍 ----------------
def test_guest_can_search_a_keyword(client):
    r = client.post("/api/v1/dictionary/key/", json={"keyword": "balay", "tribe": "tayal"})
    assert r.status_code == 200
    assert [w["name"] for w in r.json()["exact_match_results"]["balay"]] == ["balay"]


def test_guest_can_browse_all_words(client):
    r = client.post("/api/v1/dictionary/all/", json={"tribe": "tayal", "limit": 50})
    assert r.status_code == 200
    assert r.json()["total"] == len(WORDS)


def test_guest_can_get_suggestions(client):
    r = client.post("/api/v1/dictionary/suggest/", json={"keyword": "bal", "tribe": "tayal"})
    assert r.status_code == 200
    assert [s["name"] for s in r.json()["suggestions"]] == ["balay", "balay2", "kbalay"]


@pytest.mark.parametrize("method,path,body", [
    ("post", "/api/v1/dictionary/keys/", {"words": ["balay"], "tribe": "tayal"}),
    ("post", "/api/v1/dictionary/favorites-summary/", {"names": ["balay"]}),
    ("post", "/api/v1/dictionary/sentence-audio/", {"sentence": "balay", "tribe": "tayal"}),
    ("get", "/api/v1/dictionary/audio/abc", None),
    ("get", "/api/v1/dictionary/grammar/tayal", None),
])
def test_other_dictionary_endpoints_still_require_login(client, method, path, body):
    r = getattr(client, method)(path, json=body) if body is not None else getattr(client, method)(path)
    assert r.status_code == 401


def test_an_invalid_token_is_401_and_is_never_downgraded_to_guest(client, logged_in):
    r = client.post("/api/v1/dictionary/key/", json={"keyword": "balay", "tribe": "tayal"},
                    headers={"Authorization": "Bearer expired"})
    assert r.status_code == 401


def test_logged_in_user_still_works(client, logged_in):
    r = client.post("/api/v1/dictionary/key/", json={"keyword": "balay", "tribe": "tayal"}, headers=logged_in)
    assert r.status_code == 200


def test_guest_response_only_contains_public_dictionary_fields(client):
    r = client.post("/api/v1/dictionary/key/", json={"keyword": "bal", "tribe": "tayal"})
    body = r.json()
    words = [w for group in body["fuzzy_match_results"]["bal"].values() for w in group]
    assert words
    for w in words:
        assert set(w) <= PUBLIC_WORD_FIELDS
    assert set(r.json()) == {"exact_match_results", "fuzzy_match_results"}
    browse = client.post("/api/v1/dictionary/all/", json={"tribe": "tayal", "limit": 5}).json()
    assert set(browse) == {"all_results", "total", "available_letters"}
    for group in browse["all_results"].values():
        for w in group:
            assert set(w) <= PUBLIC_WORD_FIELDS
    assert set(WordResult.model_fields) == PUBLIC_WORD_FIELDS


def test_guest_browse_without_limit_is_capped(client, words):
    words.extend(_w(100 + i, f"zz{i:03d}") for i in range(S.GUEST_ALL_WORDS_MAX_LIMIT + 20))
    r = client.post("/api/v1/dictionary/all/", json={"tribe": "tayal"})
    assert r.status_code == 200
    assert len(r.json()["all_results"]) == S.GUEST_ALL_WORDS_MAX_LIMIT
    assert r.json()["total"] == len(words)


def test_guest_browse_with_a_large_limit_is_capped_too(client, words):
    # FE3-01（WP-10 驗證後修正）：帶了 limit 也要取 min(limit, 上限)，不能用 limit=500 繞過
    words.extend(_w(100 + i, f"zz{i:03d}") for i in range(S.GUEST_ALL_WORDS_MAX_LIMIT + 20))
    r = client.post("/api/v1/dictionary/all/", json={"tribe": "tayal", "limit": 500})
    assert r.status_code == 200
    assert len(r.json()["all_results"]) == S.GUEST_ALL_WORDS_MAX_LIMIT
    assert r.json()["total"] == len(words)


def test_guest_browse_with_a_small_limit_keeps_it(client, words):
    words.extend(_w(100 + i, f"zz{i:03d}") for i in range(S.GUEST_ALL_WORDS_MAX_LIMIT + 20))
    r = client.post("/api/v1/dictionary/all/", json={"tribe": "tayal", "limit": 20})
    assert len(r.json()["all_results"]) == 20


def test_logged_in_browse_with_a_large_limit_is_not_capped(client, words, logged_in):
    words.extend(_w(100 + i, f"zz{i:03d}") for i in range(S.GUEST_ALL_WORDS_MAX_LIMIT + 20))
    r = client.post("/api/v1/dictionary/all/", json={"tribe": "tayal", "limit": 500}, headers=logged_in)
    assert len(r.json()["all_results"]) == len(words)


def test_logged_in_browse_without_limit_is_not_capped(client, words, logged_in):
    words.extend(_w(100 + i, f"zz{i:03d}") for i in range(S.GUEST_ALL_WORDS_MAX_LIMIT + 20))
    r = client.post("/api/v1/dictionary/all/", json={"tribe": "tayal"}, headers=logged_in)
    assert len(r.json()["all_results"]) == len(words)


def test_guest_favorites_only_browse_is_bounded_by_names_not_capped(client, words):
    words.extend(_w(100 + i, f"zz{i:03d}") for i in range(S.GUEST_ALL_WORDS_MAX_LIMIT + 20))
    names = [w.name for w in words]
    r = client.post("/api/v1/dictionary/all/", json={"tribe": "tayal", "favorites_only": True, "favorite_names": names})
    assert len(r.json()["all_results"]) == len(words)


def _rates(guest="2/minute", member="100/minute"):
    def fake(key, default):
        return guest if key.endswith("_guest") else member
    return patch("fastAPI.rate_limit_config.get_configured_rate", side_effect=fake)


def test_guest_is_rate_limited_by_its_own_conservative_rule(client):
    with _rates():
        codes = [client.post("/api/v1/dictionary/key/", json={"keyword": "balay", "tribe": "tayal"}).status_code
                 for _ in range(3)]
    assert codes == [200, 200, 429]


def test_logged_in_user_is_not_affected_by_the_guest_rule(client, logged_in):
    with _rates():
        codes = [client.post("/api/v1/dictionary/key/", json={"keyword": "balay", "tribe": "tayal"},
                             headers=logged_in).status_code for _ in range(5)]
    assert codes == [200] * 5


def test_guest_rate_keys_have_conservative_defaults():
    seen = {}

    def capture(key, default):
        seen[key] = default
        return default

    with patch("fastAPI.rate_limit_config.get_configured_rate", side_effect=capture):
        assert S._member_or_guest_rate("m", "60/minute", *S.GUEST_RATE_ALLSEARCH)("1.2.3.4") == "30/minute"
        assert S._member_or_guest_rate("m", "60/minute", *S.GUEST_RATE_ALLSEARCH)("uid:x") == "60/minute"
    assert seen == {"dictionary_search_allsearch_guest": "30/minute", "m": "60/minute"}


def test_suggestions_have_their_own_quota_and_do_not_use_up_search(client):
    def fake(key, default):
        return "1/minute" if key == "dictionary_search_allsearch_guest" else "100/minute"
    with patch("fastAPI.rate_limit_config.get_configured_rate", side_effect=fake):
        for _ in range(5):
            assert client.post("/api/v1/dictionary/suggest/", json={"keyword": "ba", "tribe": "tayal"}).status_code == 200
        assert client.post("/api/v1/dictionary/key/", json={"keyword": "balay", "tribe": "tayal"}).status_code == 200


def test_unexpected_errors_do_not_leak_internal_details(client):
    with patch.object(S, "_search_single_keyword", side_effect=RuntimeError("C:/secret/path db password")):
        r = client.post("/api/v1/dictionary/key/", json={"keyword": "balay", "tribe": "tayal"})
    assert r.status_code == 500
    assert "secret" not in r.text and "password" not in r.text
    assert r.json() == {"detail": "伺服器發生錯誤，請稍後再試"}


# ---------------- FE3-04：建議端點 ----------------
def test_suggest_does_not_record_a_search_event_but_key_does(client):
    client.post("/api/v1/dictionary/suggest/", json={"keyword": "ba", "tribe": "tayal"})
    client.record_event.assert_not_called()
    client.post("/api/v1/dictionary/key/", json={"keyword": "balay", "tribe": "tayal"})
    assert client.record_event.call_count == 1


def test_suggest_respects_limit_and_dedupes_names(client, words):
    words.append(_w(99, "balay", "重複"))
    r = client.post("/api/v1/dictionary/suggest/", json={"keyword": "bal", "tribe": "tayal", "limit": 2})
    assert r.json()["suggestions"] == [{"name": "balay", "gloss": "真的"}, {"name": "balay2", "gloss": "真的2"}]


def test_suggest_prefix_only_keeps_only_words_starting_with_the_prefix(client):
    r = client.post("/api/v1/dictionary/suggest/", json={"keyword": "bal", "tribe": "tayal", "prefix_only": True})
    assert [s["name"] for s in r.json()["suggestions"]] == ["balay", "balay2"]


def test_suggest_by_chinese_gloss(client):
    r = client.post("/api/v1/dictionary/suggest/", json={"keyword": "真的", "tribe": "tayal"})
    assert [s["name"] for s in r.json()["suggestions"]] == ["balay", "balay2"]


@pytest.mark.parametrize("body", [{"keyword": "  ", "tribe": "tayal"}, {"keyword": "ba", "tribe": "tayal", "limit": 21},
                                  {"keyword": "ba", "tribe": "tayal", "limit": 0}])
def test_suggest_rejects_bad_input(client, body):
    assert client.post("/api/v1/dictionary/suggest/", json=body).status_code in (400, 422)


# ---------------- FE3-02：查詢正規化 ----------------
@pytest.mark.parametrize("raw,expected", [
    ("Balay", "balay"),
    ("BALAY", "balay"),
    ("’aring", "'aring"),
    ("ʼaring", "'aring"),
    ("ʻaring", "'aring"),
    ("‘aring", "'aring"),
    ("＇aring", "'aring"),
    ("´aring", "'aring"),
    ("ｂａｌａｙ", "balay"),
    ("balay\u3000", "balay"),
    ("cafe\u0301", "caf\u00e9"),          # NFD → NFC
    ("n\u0332ga", "n\u0332ga"),           # 組合底線保留，不會被刪掉
    ("  ba   lay ", "ba lay"),
])
def test_search_key_normalizes_without_dropping_letters(raw, expected):
    assert search_key(raw) == expected


def test_search_key_keeps_underlined_letters_distinct():
    assert search_key("n\u0332ga") != search_key("nga")
    assert search_key("'aring") != search_key("aring")  # 撇號（喉塞音）不能被刪掉


@pytest.mark.parametrize("keyword,expected", [
    ("Balay", "balay"),
    ("’aring", "'aring"),
    ("ʼaring", "'aring"),
    ("ｂａｌａｙ", "balay"),
    (unicodedata.normalize("NFD", "caf\u00e9"), "caf\u00e9"),
    ("yaya", "Yaya"),
    ("n\u0332ga", "n\u0332ga"),
])
def test_keyword_search_matches_any_spelling_and_keeps_original_names(client, keyword, expected):
    r = client.post("/api/v1/dictionary/key/", json={"keyword": keyword, "tribe": "tayal"})
    body = r.json()
    # 回應的鍵是使用者送來的字（去頭尾空白），詞條名稱維持辭典原字
    exact = body["exact_match_results"][keyword.strip()]
    assert [w["name"] for w in exact] == [expected]


def test_underlined_letter_query_does_not_match_the_plain_letter(client):
    r = client.post("/api/v1/dictionary/key/", json={"keyword": "n\u0332ga", "tribe": "tayal"})
    names = [w["name"] for w in r.json()["exact_match_results"]["n\u0332ga"]]
    assert "nga" not in names


def test_fuzzy_search_is_case_and_apostrophe_insensitive(client):
    r = client.post("/api/v1/dictionary/key/", json={"keyword": "BAL", "tribe": "tayal"})
    assert set(r.json()["fuzzy_match_results"]["BAL"]) == {"balay", "balay2", "kbalay"}
