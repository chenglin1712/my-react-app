"""後端寫死在程式裡的 SQL 不得使用只有單一資料庫才有的函式。

背景：正式資料庫是 PostgreSQL，SQLite 只當備份／開發用；單元測試大多跑在 SQLite 上。
若有人在 SQL 字串裡用了 SQLite 專有的語法（例如 GROUP_CONCAT），測試會全過、
上線後端點卻直接 500——/grammar/{tribe}/affixes 就是這樣壞了很久都沒人發現。
這個檢查掃描後端所有程式碼裡「看起來是 SQL」的字串常數，找出已知的單邊專有語法，
讓這類問題在寫下去的當下就失敗，而不是等到跑在正式資料庫上。

這只能擋「已知的」寫法，不能保證 SQL 一定可攜；真正的保證是對 PostgreSQL 實際跑過
（見 test_grammar_affixes_sql.py 的 TestAgainstPostgresWhenAvailable）。
"""
import ast
import re
import warnings
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2]
_SKIP_DIRS = {"tests", "migrations", "staticfiles", "__pycache__", "versions", "node_modules"}

# 單邊專有的語法／函式。名稱後面接 "(" 的才算函式呼叫，避免誤判欄位名。
_BANNED = {
    "GROUP_CONCAT": r"\bgroup_concat\s*\(",            # SQLite；PostgreSQL 要用 string_agg
    "IFNULL": r"\bifnull\s*\(",                        # SQLite／MySQL；通用寫法是 COALESCE
    "INSERT OR REPLACE/IGNORE": r"\binsert\s+or\s+(replace|ignore)\b",
    "datetime('now')": r"\bdatetime\s*\(\s*'now'",
    "SQLite strftime": r"(?<![.\w])strftime\s*\(",
    "rowid": r"\browid\b",
    "sqlite_master": r"\bsqlite_master\b",
    "STRING_AGG": r"\bstring_agg\s*\(",                # PostgreSQL 專有；SQLite 沒有
    "ARRAY_AGG": r"\barray_agg\s*\(",
    "::type cast": r"::\s*(int|integer|text|varchar|date|timestamp|numeric|jsonb?)\b",
}
_LOOKS_LIKE_SQL = re.compile(r"\bselect\b[\s\S]*\bfrom\b|\binsert\s+(or\s+\w+\s+)?into\b|\bupdate\b[\s\S]*\bset\b|\bdelete\s+from\b", re.I)


def sql_violations(source: str) -> list[tuple[int, str, str]]:
    """回傳 [(行號, 違規名稱, 字串開頭)]。只看『看起來是 SQL』的字串常數。"""
    found = []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")      # 既有程式碼裡的 regex 字串有無效逸出序列，不是這裡要檢查的事
        tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and _LOOKS_LIKE_SQL.search(node.value):
            for name, pattern in _BANNED.items():
                if re.search(pattern, node.value, re.I):
                    found.append((node.lineno, name, " ".join(node.value.split())[:60]))
    return found


def _backend_sources():
    for path in sorted(BACKEND.rglob("*.py")):
        rel = path.relative_to(BACKEND)
        if _SKIP_DIRS & set(rel.parts) or path.name.startswith("test_") or path.name == "tests.py":
            continue
        yield rel, path


class TestDetector:
    """偵測器本身要先被驗證，否則「掃描通過」不代表任何事。"""

    @pytest.mark.parametrize("sql,expected", [
        ("SELECT a, GROUP_CONCAT(b) FROM t GROUP BY a", "GROUP_CONCAT"),
        ("select group_concat (b) from t", "GROUP_CONCAT"),
        ("SELECT IFNULL(a, 0) FROM t", "IFNULL"),
        ("INSERT OR REPLACE INTO t VALUES (1)", "INSERT OR REPLACE/IGNORE"),
        ("SELECT datetime('now') FROM t", "datetime('now')"),
        ("SELECT strftime('%Y', d) FROM t", "SQLite strftime"),
        ("SELECT rowid FROM t", "rowid"),
        ("SELECT string_agg(b, ',') FROM t", "STRING_AGG"),
        ("SELECT a::text FROM t", "::type cast"),
    ])
    def test_flags_each_known_dialect_specific_construct(self, sql, expected):
        found = sql_violations(f"q = {sql!r}")
        assert [v[1] for v in found] == [expected]

    @pytest.mark.parametrize("sql", [
        "SELECT COALESCE(a, 0), COUNT(*) FROM t GROUP BY a",
        "SELECT a FROM t WHERE name = :name ORDER BY a",
        "SELECT CAST(a AS TEXT) FROM t",
    ])
    def test_does_not_flag_portable_sql(self, sql):
        assert sql_violations(f"q = {sql!r}") == []

    def test_ignores_prose_that_merely_mentions_the_function(self):
        # docstring／註解裡提到 GROUP_CONCAT 不算違規（沒有 SELECT…FROM 的結構）。
        assert sql_violations('"""原本用 GROUP_CONCAT 串規則編號"""') == []

    def test_python_strftime_method_is_not_sql(self):
        assert sql_violations("x = dt.strftime('%Y-%m-%d')") == []


def test_no_backend_sql_uses_single_database_syntax():
    violations = []
    scanned = 0
    for rel, path in _backend_sources():
        scanned += 1
        for lineno, name, snippet in sql_violations(path.read_text(encoding="utf-8")):
            violations.append(f"{rel}:{lineno}  {name}  「{snippet}」")
    assert scanned > 50, "掃描的檔案數異常少，路徑設定可能壞了"
    assert not violations, "以下 SQL 使用了只有單一資料庫才有的語法（正式環境是 PostgreSQL）：\n" + "\n".join(violations)
