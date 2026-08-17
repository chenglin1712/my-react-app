"""測試 fastAPI/routes/dictionary/grammar.py 的 _load_grammar 資料存取／組裝拆分：
原本 4 層巢狀迴圈裡查詢（db.execute）跟組裝（建 dict）混在一起，拆成
_fetch_*（只查詢，回傳原始 row）與 _format_*（純組裝，不碰 db）兩類函式後，
這裡分別驗證每一類函式的行為，以及 _load_grammar 把兩者組回原本回應格式的
邏輯沒有跑掉。
"""
from unittest.mock import MagicMock

from fastAPI.routes.dictionary import grammar as grammar_module
from fastAPI.routes.dictionary.grammar import (
    _fetch_example_word_map,
    _fetch_examples_for_rules,
    _fetch_rule_affix_map,
    _fetch_rules_for_sections,
    _format_rule,
    _format_section,
    _load_grammar,
    _load_grammar_quiz_material,
)
from fastAPI.routes.keyed_cache import KeyedCache


class TestFormatRule:
    def test_builds_expected_shape_from_raw_rows(self):
        rule_row = (1, 1, "rule-1", "標題", "結構", "功能", "備註")
        affix_map = {1: ["ma-", "-en"]}
        examples = [(10, 1, "tribe text", "中文", "分析")]
        word_map = {10: ["word-1", "word-2"]}

        result = _format_rule(rule_row, affix_map, examples, word_map)

        assert result["id"] == 1
        assert result["affix_tags"] == ["ma-", "-en"]
        assert result["examples"] == [{
            "id": 10, "tribe_text": "tribe text", "chinese_text": "中文",
            "analysis": "分析", "linked_word_ids": ["word-1", "word-2"],
        }]

    def test_example_with_no_linked_words_gets_empty_list(self):
        rule_row = (1, 1, "rule-1", "標題", "結構", "功能", "備註")
        examples = [(10, 1, "tribe text", "中文", "分析")]

        result = _format_rule(rule_row, affix_map={}, examples=examples, word_map={})

        assert result["examples"][0]["linked_word_ids"] == []

    def test_rule_with_no_affixes_gets_empty_list(self):
        rule_row = (2, 1, "rule-2", "標題", "結構", "功能", "備註")
        result = _format_rule(rule_row, affix_map={}, examples=[], word_map={})
        assert result["affix_tags"] == []
        assert result["examples"] == []


class TestFormatSection:
    def test_builds_expected_shape(self):
        section_row = (1, 1, "sec-1", "章節標題", "描述")
        rules_out = [{"id": 1}]
        result = _format_section(section_row, rules_out)
        assert result == {
            "id": 1, "order": 1, "section_key": "sec-1",
            "title": "章節標題", "description": "描述", "rules": rules_out,
        }


class TestFetchRuleAffixMap:
    def test_empty_rule_ids_skips_query(self):
        db = MagicMock()
        result = _fetch_rule_affix_map(db, [])
        assert result == {}
        db.execute.assert_not_called()

    def test_groups_affixes_by_rule_id(self):
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = [(1, "ma-"), (1, "-en"), (2, "pa-")]
        result = _fetch_rule_affix_map(db, [1, 2, 3])
        assert result == {1: ["ma-", "-en"], 2: ["pa-"], 3: []}


class TestFetchRulesForSections:
    """P4 review BE-19：批次載入多個 section 的 rule，取代原本逐 section
    各查一次的 N+1 寫法。"""

    def test_empty_section_ids_skips_query(self):
        db = MagicMock()
        result = _fetch_rules_for_sections(db, [])
        assert result == {}
        db.execute.assert_not_called()

    def test_groups_rules_by_section_id_and_strips_section_id_column(self):
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = [
            (100, 1, 1, "rule-1", "標題1", "結構1", "功能1", "備註1"),
            (100, 2, 2, "rule-2", "標題2", "結構2", "功能2", "備註2"),
            (200, 3, 1, "rule-3", "標題3", "結構3", "功能3", "備註3"),
        ]

        result = _fetch_rules_for_sections(db, [100, 200, 300])

        assert result[100] == [
            (1, 1, "rule-1", "標題1", "結構1", "功能1", "備註1"),
            (2, 2, "rule-2", "標題2", "結構2", "功能2", "備註2"),
        ]
        assert result[200] == [(3, 1, "rule-3", "標題3", "結構3", "功能3", "備註3")]
        assert result[300] == []  # 沒有 rule 的 section 仍要有一個空 list


class TestFetchExamplesForRules:
    """P4 review BE-19：批次載入多個 rule 的 example，取代原本逐 rule
    各查一次的 N+1 寫法（巢狀在逐 section 查 rule 裡面的第二層）。"""

    def test_empty_rule_ids_skips_query(self):
        db = MagicMock()
        result = _fetch_examples_for_rules(db, [])
        assert result == {}
        db.execute.assert_not_called()

    def test_groups_examples_by_rule_id_and_strips_rule_id_column(self):
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = [
            (1, 10, 1, "tribe text A", "中文A", "分析A"),
            (1, 11, 2, "tribe text B", "中文B", "分析B"),
            (2, 12, 1, "tribe text C", "中文C", "分析C"),
        ]

        result = _fetch_examples_for_rules(db, [1, 2, 3])

        assert result[1] == [
            (10, 1, "tribe text A", "中文A", "分析A"),
            (11, 2, "tribe text B", "中文B", "分析B"),
        ]
        assert result[2] == [(12, 1, "tribe text C", "中文C", "分析C")]
        assert result[3] == []  # 沒有 example 的 rule 仍要有一個空 list


class TestFetchExampleWordMap:
    """P4.3 補上——原本 _format_rule 一直寫死 linked_word_ids: []，這裡跟
    _fetch_rule_affix_map 是同一種批次查詢/依 id 分組的形狀。"""

    def test_empty_example_ids_skips_query(self):
        db = MagicMock()
        result = _fetch_example_word_map(db, [])
        assert result == {}
        db.execute.assert_not_called()

    def test_groups_word_ids_by_example_id(self):
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = [(10, "word-1"), (10, "word-2"), (20, "word-3")]
        result = _fetch_example_word_map(db, [10, 20, 30])
        assert result == {10: ["word-1", "word-2"], 20: ["word-3"], 30: []}


class TestLoadGrammarOrchestration:
    """驗證 _load_grammar 呼叫 _fetch_* 的次數/順序（P4 review BE-19 修正
    後）：不論這個族語有幾個章節/規則/例句，固定 5 次批次查詢，不再是
    「逐 section 查 rule、逐 rule 查 example」的 N+1。"""

    def setup_method(self):
        grammar_module._grammar_cache = KeyedCache()

    def test_no_sections_returns_none_and_does_not_cache(self):
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = []  # sections 查詢回空

        assert _load_grammar(db, "不存在的部落") is None
        assert "不存在的部落" not in grammar_module._grammar_cache
        # 第二次呼叫應該再次查詢（沒有被快取住），而不是永遠回傳 None
        assert _load_grammar(db, "不存在的部落") is None
        assert db.execute.call_count == 2

    def test_assembles_sections_rules_examples_and_affixes(self):
        db = MagicMock()

        section_row = (100, 1, "sec-1", "第一章", "章節描述")
        # 批次查詢多帶一欄分組鍵（section_id／rule_id）在最前面。
        rule_row_with_section_id = (100, 200, 1, "rule-1", "規則標題", "結構", "功能", "備註")
        example_row_with_rule_id = (200, 300, 1, "tribe text", "中文翻譯", "分析說明")
        affix_rows = [(200, "ma-")]
        word_rows = [(300, "word-1")]

        # 依照 _load_grammar 的呼叫順序回傳對應結果，固定 5 次查詢：
        # 1) sections  2) 全部 section 的 rules（批次）
        # 3) 全部 rule 的 affix_map（批次）  4) 全部 rule 的 examples（批次）
        # 5) 全部 example 的 word_map（批次）
        db.execute.return_value.fetchall.side_effect = [
            [section_row],
            [rule_row_with_section_id],
            affix_rows,
            [example_row_with_rule_id],
            word_rows,
        ]

        payload = _load_grammar(db, "泰雅語")

        assert db.execute.call_count == 5
        assert payload["tribe"] == "泰雅語"
        assert len(payload["sections"]) == 1
        section = payload["sections"][0]
        assert section["id"] == 100
        assert len(section["rules"]) == 1
        rule = section["rules"][0]
        assert rule["id"] == 200
        assert rule["affix_tags"] == ["ma-"]
        assert rule["examples"] == [{
            "id": 300, "tribe_text": "tribe text", "chinese_text": "中文翻譯",
            "analysis": "分析說明", "linked_word_ids": ["word-1"],
        }]

    def test_query_count_does_not_grow_with_more_sections_or_rules(self):
        """N+1 修正的核心保證：3 個 section、每個 section 2 個 rule、每個
        rule 2 個 example，查詢次數仍然是固定的 5 次，不是隨章節/規則數
        線性成長。"""
        db = MagicMock()

        sections = [(i, i, f"sec-{i}", f"章節{i}", "描述") for i in range(1, 4)]
        rules = [
            (sec_id, sec_id * 10 + j, j, f"rule-{sec_id}-{j}", "標題", "結構", "功能", "備註")
            for sec_id in range(1, 4) for j in range(1, 3)
        ]
        rule_ids = [r[1] for r in rules]
        examples = [
            (rid, rid * 100 + k, k, "tribe", "中文", "分析")
            for rid in rule_ids for k in range(1, 3)
        ]

        db.execute.return_value.fetchall.side_effect = [sections, rules, [], examples, []]

        payload = _load_grammar(db, "泰雅語")

        assert db.execute.call_count == 5  # 3 章節、6 規則、12 例句，查詢次數仍是 5
        assert len(payload["sections"]) == 3
        assert sum(len(s["rules"]) for s in payload["sections"]) == 6
        assert sum(len(r["examples"]) for s in payload["sections"] for r in s["rules"]) == 12

    def test_second_call_hits_cache_not_db(self):
        db = MagicMock()
        db.execute.return_value.fetchall.side_effect = [
            [(100, 1, "sec-1", "第一章", "描述")],
            [],   # 該 section 沒有 rule，all_rule_ids 是空的，後面 3 次查詢因此被跳過
        ]

        first = _load_grammar(db, "泰雅語")
        call_count_after_first = db.execute.call_count
        second = _load_grammar(db, "泰雅語")

        assert call_count_after_first == 2
        assert first is second  # 同一個快取住的 dict 物件
        assert db.execute.call_count == call_count_after_first


class TestLoadGrammarQuizMaterialCacheBounding:
    """_load_grammar_quiz_material 的 section_key 是自由文字模糊搜尋，不像
    affix_type 能收斂成固定白名單；如果直接拿它當快取 key，任何已登入使用者
    每次帶不同字串就能讓 _grammar_quiz_cache 無上限成長（稽核修正第 6 項）。
    驗證：帶 section_key 一律不快取（每次都重新查 DB），只有「查全部規則」
    （section_key 為 None）才走快取，key 空間只剩 tribe_name，跟其他呼叫端
    一樣有限。"""

    def setup_method(self):
        grammar_module._grammar_quiz_cache = KeyedCache()

    def test_section_key_query_bypasses_cache_every_call(self):
        db = MagicMock()
        db.execute.return_value.fetchall.side_effect = [[], []]

        _load_grammar_quiz_material(db, "泰雅語", "section-a")
        count_after_first = db.execute.call_count
        _load_grammar_quiz_material(db, "泰雅語", "section-a")

        # 就算 tribe/section_key 完全相同，第二次呼叫還是要重新查 DB——
        # 這正是要堵住的漏洞：如果快取住了，攻擊者帶入的任意字串就會變成
        # 一筆永久快取。
        assert db.execute.call_count > count_after_first

    def test_different_section_keys_never_accumulate_in_cache(self):
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = []

        for i in range(5):
            _load_grammar_quiz_material(db, "泰雅語", f"random-{i}")

        # KeyedCache 沒有 eviction/TTL，只增不減；section_key 一律不快取，
        # 所以無論帶多少個不同字串，_grammar_quiz_cache 內部都不會累積任何一筆。
        assert len(grammar_module._grammar_quiz_cache._values) == 0

    def test_no_section_key_uses_bounded_tribe_key_cache(self):
        db = MagicMock()
        db.execute.return_value.fetchall.side_effect = [[]]

        first = _load_grammar_quiz_material(db, "泰雅語", None)
        count_after_first = db.execute.call_count
        second = _load_grammar_quiz_material(db, "泰雅語", None)

        assert first is second  # 同一個快取住的 dict 物件
        assert db.execute.call_count == count_after_first
