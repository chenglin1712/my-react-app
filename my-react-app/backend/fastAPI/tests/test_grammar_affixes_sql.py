"""GET /grammar/{tribe}/affixes 的資料存取（_fetch_affixes／_fetch_affix_rule_ids／
_format_affixes／_load_grammar_affixes）。

為什麼要有這個檔案：這個端點原本在 SQL 裡用 GROUP_CONCAT 串規則編號——那是 SQLite
專有的函式，PostgreSQL 沒有，正式資料庫上整個端點會 500。既有的端點測試把
_load_grammar_affixes 整個 mock 掉，這段 SQL 從來沒有真的被執行過，所以測試全過、
問題卻一直存在。這裡用真實的資料表（記憶體內 SQLite）實際跑 SQL，另外：
- 攔截實際送出的 SQL，確認沒有任何一種資料庫專有的語法（兩種資料庫都要能跑）；
- 若目前連的資料庫是 PostgreSQL，另外對真實資料跑一次對照（否則自動略過）。
"""
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from dictionary_db.model import (
    Base, GrammarAffix, GrammarRule, GrammarRuleAffix, GrammarSection, Tribe,
)
from fastAPI.routes.dictionary import grammar as G

_TABLES = [Tribe.__table__, GrammarSection.__table__, GrammarRule.__table__,
           GrammarAffix.__table__, GrammarRuleAffix.__table__]


@pytest.fixture
def db():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine, tables=_TABLES)
    session = sessionmaker(bind=engine)()
    G._grammar_affixes_cache.clear()
    yield session
    session.close()
    G._grammar_affixes_cache.clear()


def _seed(db):
    db.add_all([Tribe(id="t-tayal", name="泰雅語", slug="tayal"), Tribe(id="t-amis", name="阿美語", slug="amis")])
    db.add_all([GrammarSection(id=1, tribe_id="t-tayal", title="章"), GrammarSection(id=2, tribe_id="t-amis", title="章")])
    db.add_all([GrammarRule(id=r, section_id=1 if r < 100 else 2, title=f"規則{r}") for r in (5, 3, 9, 100)])
    db.add_all([
        GrammarAffix(id=1, tribe_id="t-tayal", affix="m-", affix_type="prefix", function="主事", example_form="m-alaw"),
        GrammarAffix(id=2, tribe_id="t-tayal", affix="ma-", affix_type="prefix", function="狀態", example_form=None),
        GrammarAffix(id=3, tribe_id="t-tayal", affix="-in-", affix_type="infix", function="完成", example_form="s-in-alaw"),
        GrammarAffix(id=4, tribe_id="t-tayal", affix="-en", affix_type="suffix", function="受事", example_form=None),
        GrammarAffix(id=9, tribe_id="t-amis", affix="mi-", affix_type="prefix", function="別族", example_form=None),
    ])
    db.flush()
    # 詞綴 1 掛三條規則（刻意不依編號順序插入）、詞綴 3 掛一條、詞綴 2 與 4 沒有；別族詞綴 9 掛規則 100。
    db.add_all([
        GrammarRuleAffix(rule_id=9, affix_id=1), GrammarRuleAffix(rule_id=3, affix_id=1),
        GrammarRuleAffix(rule_id=5, affix_id=1), GrammarRuleAffix(rule_id=5, affix_id=3),
        GrammarRuleAffix(rule_id=100, affix_id=9),
    ])
    db.commit()


class TestLoadGrammarAffixes:
    def test_returns_every_affix_of_the_tribe_with_its_rule_ids(self, db):
        _seed(db)
        out = G._load_grammar_affixes(db, "泰雅語", None)
        assert out["tribe"] == "泰雅語"
        by_affix = {a["affix"]: a for a in out["affixes"]}
        assert set(by_affix) == {"m-", "ma-", "-in-", "-en"}
        assert by_affix["m-"]["rule_ids"] == [3, 5, 9]      # 由小到大，與插入順序無關
        assert by_affix["-in-"]["rule_ids"] == [5]
        assert by_affix["ma-"]["rule_ids"] == [] and by_affix["-en"]["rule_ids"] == []

    def test_rule_ids_are_integers_not_strings(self, db):
        # 原本 GROUP_CONCAT 回傳字串、要再 int() 轉回來；改寫後必須仍是整數。
        _seed(db)
        ids = G._load_grammar_affixes(db, "泰雅語", None)["affixes"][0]["rule_ids"]
        assert all(type(i) is int for i in ids)

    def test_each_affix_row_has_exactly_the_documented_fields(self, db):
        _seed(db)
        row = next(a for a in G._load_grammar_affixes(db, "泰雅語", None)["affixes"] if a["affix"] == "m-")
        assert row == {"id": 1, "affix": "m-", "affix_type": "prefix", "function": "主事",
                       "example_form": "m-alaw", "rule_ids": [3, 5, 9]}

    def test_without_filter_order_is_by_type_then_affix(self, db):
        _seed(db)
        order = [(a["affix_type"], a["affix"]) for a in G._load_grammar_affixes(db, "泰雅語", None)["affixes"]]
        assert order == sorted(order) == [("infix", "-in-"), ("prefix", "m-"), ("prefix", "ma-"), ("suffix", "-en")]

    def test_affix_type_filter_limits_both_the_affixes_and_their_rule_ids(self, db):
        _seed(db)
        out = G._load_grammar_affixes(db, "泰雅語", "prefix")["affixes"]
        assert [a["affix"] for a in out] == ["m-", "ma-"]
        assert out[0]["rule_ids"] == [3, 5, 9]
        assert G._load_grammar_affixes(db, "泰雅語", "infix")["affixes"][0]["rule_ids"] == [5]

    def test_affix_type_filter_with_no_matches_returns_empty_list(self, db):
        _seed(db)
        assert G._load_grammar_affixes(db, "泰雅語", "circumfix")["affixes"] == []

    def test_other_tribes_affixes_and_rule_links_never_leak_in(self, db):
        _seed(db)
        tayal = G._load_grammar_affixes(db, "泰雅語", None)["affixes"]
        amis = G._load_grammar_affixes(db, "阿美語", None)["affixes"]
        assert all(a["affix"] != "mi-" for a in tayal)
        assert [(a["affix"], a["rule_ids"]) for a in amis] == [("mi-", [100])]

    def test_unknown_tribe_returns_empty_list_instead_of_failing(self, db):
        _seed(db)
        assert G._load_grammar_affixes(db, "不存在的族語", None)["affixes"] == []

    def test_results_are_cached_per_tribe_and_affix_type(self, db):
        _seed(db)
        first = G._load_grammar_affixes(db, "泰雅語", None)
        db.add(GrammarAffix(id=77, tribe_id="t-tayal", affix="new-", affix_type="prefix"))
        db.commit()
        assert G._load_grammar_affixes(db, "泰雅語", None) is first      # 命中快取
        assert any(a["affix"] == "new-" for a in G._load_grammar_affixes(db, "泰雅語", "prefix")["affixes"])


class TestPortableSql:
    def test_only_portable_sql_is_sent_to_the_database(self, db):
        # 兩種資料庫都要能跑：不得出現任何一邊專有的函式或語法。
        _seed(db)
        sent = []

        @event.listens_for(db.bind, "before_cursor_execute")
        def capture(conn, cursor, statement, parameters, context, executemany):
            sent.append(statement.lower())

        for at in (None, "prefix"):
            G._grammar_affixes_cache.clear()
            G._load_grammar_affixes(db, "泰雅語", at)
        assert sent
        for sql in sent:
            for banned in ("group_concat", "string_agg", "array_agg", "ifnull(", "pragma", "rowid"):
                assert banned not in sql, (banned, sql)


class TestFormatAffixes:
    def test_missing_entry_in_the_rule_map_means_no_rules(self):
        rows = [(1, "m-", "prefix", "功能", None)]
        out = G._format_affixes("泰雅語", rows, {})
        assert out == {"tribe": "泰雅語", "affixes": [
            {"id": 1, "affix": "m-", "affix_type": "prefix", "function": "功能", "example_form": None, "rule_ids": []}]}

    def test_rule_ids_are_copied_not_shared_with_the_input(self):
        shared = {1: [1, 2]}
        out = G._format_affixes("t", [(1, "m-", "prefix", None, None)], shared)
        out["affixes"][0]["rule_ids"].append(99)
        assert shared == {1: [1, 2]}


class TestAgainstPostgresWhenAvailable:
    """目前連線若是 PostgreSQL（有設定 DICTIONARY_DATABASE_URL／DATABASE_URL），就對真實資料
    跑一次，並與用 ORM 直接算出來的結果對照；是 SQLite 時自動略過。唯讀，不寫任何資料。"""

    @pytest.fixture
    def pg(self):
        from dictionary_db.connect import SessionLocal
        session = SessionLocal()
        if session.bind.dialect.name != "postgresql":
            session.close()
            pytest.skip("目前連線不是 PostgreSQL")
        G._grammar_affixes_cache.clear()
        yield session
        session.close()
        G._grammar_affixes_cache.clear()

    def test_every_tribe_and_affix_type_matches_the_orm(self, pg):
        from config.tribes import TRIBES
        for tribe in TRIBES:
            for affix_type in (None, "prefix", "suffix", "infix"):
                G._grammar_affixes_cache.clear()
                got = G._load_grammar_affixes(pg, tribe.full_name, affix_type)["affixes"]
                query = pg.query(GrammarAffix).filter(GrammarAffix.tribe_id == tribe.id)
                if affix_type:
                    query = query.filter(GrammarAffix.affix_type == affix_type)
                expected = {}
                for a in query.all():
                    ids = sorted(r for (r,) in pg.query(GrammarRuleAffix.rule_id).filter(GrammarRuleAffix.affix_id == a.id))
                    expected[a.id] = (a.affix, a.affix_type, a.function, a.example_form, ids)
                assert {x["id"]: (x["affix"], x["affix_type"], x["function"], x["example_form"], x["rule_ids"]) for x in got} == expected
