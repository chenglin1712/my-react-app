"""O13：翻譯用詞綴規則快取要能失效；O18：取「第一筆」的查詢要有確定的排序，視窗片語只正規化一次。"""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from fastAPI.main import app
from fastAPI.routes.translation import retrieve as R
from fastAPI.routes.translation import service as S

_SECRET = "correct-secret-0123456789-0123456789-abcdef"


# ---------------- O13 ----------------

def _db_returning(rows):
    db = MagicMock()
    db.query.return_value.filter.return_value.all.return_value = rows
    return db


@pytest.fixture(autouse=True)
def _clean_strip_cache():
    S.invalidate_strip_rules()
    yield
    S.invalidate_strip_rules()


def test_strip_rules_are_built_once_per_tribe_until_invalidated():
    db = _db_returning([("ma-", "動詞")])
    with patch.object(S.lexicon, "build_strip_rules", side_effect=lambda rows: ("rules", len(rows))) as build:
        first = S._get_strip_rules(db, "t1")
        assert S._get_strip_rules(db, "t1") is first
        S._get_strip_rules(db, "t2")
        assert build.call_count == 2          # t1、t2 各一次

        S.invalidate_strip_rules("t1")        # 後台改了詞綴
        S._get_strip_rules(db, "t1")
        S._get_strip_rules(db, "t2")
        assert build.call_count == 3          # 只有 t1 重建，t2 沿用


def test_invalidate_without_a_tribe_clears_every_tribe():
    db = _db_returning([])
    with patch.object(S.lexicon, "build_strip_rules", return_value=object()) as build:
        S._get_strip_rules(db, "a")
        S._get_strip_rules(db, "b")
        S.invalidate_strip_rules()
        S._get_strip_rules(db, "a")
        S._get_strip_rules(db, "b")
    assert build.call_count == 4


def test_grammar_affixes_invalidate_scope_also_clears_the_translation_strip_rules(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", _SECRET)
    db = _db_returning([])
    with patch.object(S.lexicon, "build_strip_rules", return_value=object()) as build:
        S._get_strip_rules(db, "5d2b7a14-0000-0000-0000-000000000000")  # 與下面無關的族語：不應被清掉
        from fastAPI.routes import internal
        tribe_id = internal._TRIBE_ID_BY_NAME["泰雅語"]
        S._get_strip_rules(db, tribe_id)
        assert build.call_count == 2

        with TestClient(app) as client:
            resp = client.post("/internal/cache/invalidate",
                               json={"scopes": ["grammar_affixes"], "tribes": ["tayal"]},
                               headers={"X-Internal-Secret": _SECRET})
        assert resp.status_code == 200

        S._get_strip_rules(db, tribe_id)
        assert build.call_count == 3          # 泰雅語的規則被清掉、重建


# ---------------- O18 ----------------

def _capturing_db():
    db = MagicMock()
    db.bind.dialect.name = "postgresql"
    statements = []

    def execute(statement, params=None):
        statements.append(str(statement))
        return MagicMock(fetchall=lambda: [])

    db.execute.side_effect = execute
    return db, statements


def test_headword_batch_query_has_a_deterministic_order():
    db, statements = _capturing_db()
    R.lookup_headwords_batch(db, "t", ["balay"])
    assert "ORDER BY w.id" in statements[0]


def test_exact_chinese_gloss_query_has_a_deterministic_order_before_the_limit():
    db, statements = _capturing_db()
    R.retrieve_zh_gloss_words(db, "t", "水", k=5)
    sql = " ".join(statements[0].split())   # 空白與換行壓成單一空格再比對
    assert "ORDER BY w.id LIMIT :k" in sql   # 排序在 LIMIT 之前，取到的前 k 筆才固定


def test_headword_batch_takes_the_first_row_in_query_order_for_duplicate_forms():
    db = MagicMock()
    db.bind.dialect.name = "postgresql"
    rows = [SimpleNamespace(norm_name="su", id="a1", name="su", gloss="第一筆", audio_file_id=None),
            SimpleNamespace(norm_name="su", id="a2", name="su", gloss="第二筆", audio_file_id=None)]
    db.execute.return_value.fetchall.return_value = rows
    assert R.lookup_headwords_batch(db, "t", ["su"])["su"].gloss == "第一筆"


def test_each_window_phrase_is_normalised_only_once():
    from config import translation_lexicon as lexicon
    calls = []
    real = lexicon.normalize_phrase

    def counting(tokens):
        calls.append(tuple(tokens))
        return real(tokens)

    with patch.object(lexicon, "normalize_phrase", side_effect=counting), \
         patch.object(R, "lookup_headwords_batch", return_value={}), \
         patch.object(R, "lookup_attested_batch", return_value={}):
        R.corroborate_tokens(None, "t", ["a", "b", "c"])

    # 3 個 token、視窗最大 3：視窗數 = 3 + 2 + 1 = 6；候選迴圈算一次，貪婪比對沿用，不再重算
    assert len(calls) == 6
