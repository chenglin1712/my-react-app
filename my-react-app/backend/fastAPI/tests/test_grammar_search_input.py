"""稽核 MSC-4：文法搜尋的 q 要有長度上限，且 LIKE 的萬用字元（%、_、反斜線）要跳脫。

用記憶體 SQLite 建出文法相關資料表，打真正的端點：沒跳脫時輸入 "%" 會比對到所有規則。
"""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from dictionary_db.connect import get_db
from fastAPI.main import app
from fastAPI.rate_limit import limiter
from fastAPI.routes import auth as auth_module
from fastAPI.routes.dictionary.grammar import _MAX_SEARCH_QUERY_LENGTH, _escape_like

TRIBE_NAME = "泰雅語"


@pytest.fixture
def client():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE tribe (id INTEGER PRIMARY KEY, name TEXT)"))
        conn.execute(text("CREATE TABLE grammar_section (id INTEGER PRIMARY KEY, tribe_id INTEGER, section_key TEXT)"))
        conn.execute(text(
            "CREATE TABLE grammar_rule (id INTEGER PRIMARY KEY, section_id INTEGER, rule_key TEXT, title TEXT, "
            "structure TEXT, function TEXT, notes TEXT, rule_order INTEGER)"))
        conn.execute(text(
            "CREATE TABLE grammar_example (id INTEGER PRIMARY KEY, rule_id INTEGER, tribe_text TEXT, chinese_text TEXT, analysis TEXT, example_order INTEGER)"))
        conn.execute(text("CREATE TABLE grammar_affix (id INTEGER PRIMARY KEY, tribe_id INTEGER, affix TEXT, affix_type TEXT, function TEXT, example_form TEXT)"))
        conn.execute(text("CREATE TABLE grammar_rule_affix (rule_id INTEGER, affix_id INTEGER)"))
        conn.execute(text("INSERT INTO tribe (id, name) VALUES (1, :n)"), {"n": TRIBE_NAME})
        conn.execute(text("INSERT INTO grammar_section (id, tribe_id, section_key) VALUES (1, 1, 'ch_1'), (2, 1, 'chXx')"))
        conn.execute(text("INSERT INTO grammar_affix VALUES (1, 1, 'm_', 'prefix', '50% 的詞綴', ''), (2, 1, 'mX', 'prefix', '其他', '')"))
        rules = [
            (1, "r1", "100% 完成", "S", "表示完成", "", 1),
            (2, "r2", "普通規則", "S", "沒有特殊字元", "", 2),
            (3, "r3", "snake_case 規則", "S", "含底線", "", 3),
            (4, "r4", "snakeXcase 規則", "S", "不含底線", "", 4),
            (5, "r5", "路徑 a\\b", "S", "含反斜線", "", 5),
            (6, "r6", "驚嘆!", "S", "含驚嘆號", "", 6),
        ]
        for rid, key, title, structure, function, notes, order in rules:
            conn.execute(
                text("INSERT INTO grammar_rule VALUES (:id, :sec, :k, :t, :s, :f, :n, :o)"),
                {"id": rid, "sec": 2 if rid == 4 else 1, "k": key, "t": title, "s": structure, "f": function, "n": notes, "o": order},
            )
            conn.execute(
                text("INSERT INTO grammar_example VALUES (:id, :id, :tt, '中文', '', 1)"), {"id": rid, "tt": f"例句{rid}"},
            )
    maker = sessionmaker(bind=engine)

    def _db():
        session = maker()
        try:
            yield session
        finally:
            session.close()

    async def _auth():
        return {"uid": "test-user"}

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[auth_module.verify_firebase_token] = _auth
    limiter.reset()
    try:
        with patch("fastAPI.rate_limit_config.get_configured_rate", side_effect=lambda key, default: default):
            with TestClient(app) as test_client:
                yield test_client
    finally:
        app.dependency_overrides.clear()
        limiter.reset()


def _titles(response):
    assert response.status_code == 200, response.text
    body = response.json()
    rules = body.get("rules") or body.get("results") or []
    return sorted(r.get("title", "") for r in rules)


def _search(client, q):
    return client.get("/api/v1/dictionary/grammar/tayal/search", params={"q": q})


def test_helper_escapes_wildcards_and_the_escape_character():
    assert _escape_like("a%b_c!d") == "a!%b!_c!!d"
    assert _escape_like("plain") == "plain"
    assert _escape_like("a\\b") == "a\\b"          # 反斜線不再是特殊字元，原樣保留


def test_a_percent_sign_matches_only_text_that_contains_a_percent_sign(client):
    assert _titles(_search(client, "%")) == ["100% 完成"]


def test_an_underscore_is_literal_not_a_single_character_wildcard(client):
    assert _titles(_search(client, "snake_case")) == ["snake_case 規則"]       # 沒跳脫時 snakeXcase 也會中


def test_a_backslash_is_literal(client):
    assert _titles(_search(client, "a\\b")) == ["路徑 a\\b"]


def test_the_escape_character_itself_is_literal(client):
    assert _titles(_search(client, "嘆!")) == ["驚嘆!"]


def test_ordinary_search_still_works(client):
    assert _titles(_search(client, "普通")) == ["普通規則"]


def test_query_over_the_length_limit_is_rejected_before_any_query(client):
    assert _search(client, "x" * _MAX_SEARCH_QUERY_LENGTH).status_code == 200
    assert _search(client, "x" * (_MAX_SEARCH_QUERY_LENGTH + 1)).status_code == 422


def test_empty_query_is_rejected(client):
    assert _search(client, "").status_code == 422


def test_affix_search_escapes_wildcards_too(client):
    body = _search(client, "m_").json()
    assert [a["affix"] for a in body["affixes"]] == ["m_"]           # 沒跳脫時 mX 也會中
    assert [a["affix"] for a in _search(client, "50%").json()["affixes"]] == ["m_"]


def test_quiz_section_key_is_escaped_and_length_limited(client):
    base = "/api/v1/dictionary/grammar/tayal/quiz"
    keys = lambda r: sorted(rule["rule_key"] for rule in r.json()["rules"])       # noqa: E731
    assert keys(client.get(base, params={"section_key": "ch_1"})) == ["r1", "r2", "r3", "r5", "r6"]   # 底線是字面字元，不比對 chXx
    assert client.get(base, params={"section_key": "x" * (_MAX_SEARCH_QUERY_LENGTH + 1)}).status_code == 422
