"""fastAPI.routes.translation.retrieve 的 corroborate_tokens／
corroborate_full_sentence 測試——這是整個佐證檢核機制最容易出錯的部分
（多詞最長匹配、跨標點的相鄰性判斷、三層 fallback）。

Mock 掉 lookup_headwords_batch／lookup_attested_batch（唯一會碰 DB 的部分），
只測純邏輯：候選片語怎麼組、貪婪比對怎麼消耗 token、殘餘怎麼落回
Tier A/B/C/D。不需要真的連 PostgreSQL，CI 環境沒有 pg_trgm 也能跑
（比照 test_dictionary_search_all.py mock _load_tribe_words 的既有慣例）。
"""
from unittest.mock import patch

from config import translation_lexicon as lexicon
from fastAPI.routes.translation import retrieve as R

_TRIBE_ID = "fake-tribe-id"


def _word(name, gloss="釋義"):
    return R.WordMatch(id=f"id-{name}", name=name, gloss=gloss, audio_file_id=None)


class TestCorroborateTokensMultiWord:
    def test_multi_token_headword_matched_as_single_span(self):
        # 曾經是真的 bug：多詞詞條（如 "babaw nya'"）在佐證檢核階段被拆成
        # 兩個各自查表的單詞，其中一個查無獨立詞條就整段被標成 unsupported。
        headwords = {"babaw nya'": _word("babaw nya'", "未來")}
        with patch.object(R, "lookup_headwords_batch", return_value=headwords), \
             patch.object(R, "lookup_attested_batch", return_value={}):
            spans = R.corroborate_tokens(None, _TRIBE_ID, ["babaw", "nya'", "rgyax"])

        assert spans[0].status == "headword"
        assert spans[0].token_count == 2
        assert spans[0].surface == "babaw nya'"
        assert spans[1].status == "unsupported"  # "rgyax" 沒被 mock 進 headwords

    def test_longest_match_preferred_over_shorter_overlapping_match(self):
        # "babaw" 單獨也是一個詞條，但 "babaw nya'" 兩詞組成的詞條應該優先
        # 被吃掉（最長匹配），不能只比對到 "babaw" 就停。
        headwords = {
            "babaw": _word("babaw", "上面"),
            "babaw nya'": _word("babaw nya'", "未來"),
        }
        with patch.object(R, "lookup_headwords_batch", return_value=headwords), \
             patch.object(R, "lookup_attested_batch", return_value={}):
            spans = R.corroborate_tokens(None, _TRIBE_ID, ["babaw", "nya'"])

        assert len(spans) == 1
        assert spans[0].token_count == 2
        assert spans[0].lemma == "babaw nya'"

    def test_attested_tier_used_when_not_a_headword(self):
        # 曾經是真的 bug：族語→中文方向完全沒查 attested/derived 兩層，只
        # 查 headword，語料裡才有的詞形一律誤判成查無釋義。
        with patch.object(R, "lookup_headwords_batch", return_value={}), \
             patch.object(R, "lookup_attested_batch", return_value={"piyux": 42}):
            spans = R.corroborate_tokens(None, _TRIBE_ID, ["piyux"])

        assert spans[0].status == "attested"
        assert spans[0].sentence_ref == 42

    def test_derived_tier_via_prefix_strip(self):
        strip_rules = lexicon.build_strip_rules([{"affix": "m-", "function": "主事焦點"}])
        headwords_by_call = [{}, {"alaw": _word("alaw", "打獵")}]

        def fake_headwords(db, tribe_id, forms):
            return headwords_by_call.pop(0)

        with patch.object(R, "lookup_headwords_batch", side_effect=fake_headwords), \
             patch.object(R, "lookup_attested_batch", return_value={}):
            spans = R.corroborate_tokens(None, _TRIBE_ID, ["malaw"], strip_rules=strip_rules)

        assert spans[0].status == "derived"
        assert spans[0].lemma == "alaw"
        assert "主事焦點" in spans[0].note

    def test_unsupported_when_nothing_matches(self):
        with patch.object(R, "lookup_headwords_batch", return_value={}), \
             patch.object(R, "lookup_attested_batch", return_value={}):
            spans = R.corroborate_tokens(None, _TRIBE_ID, ["xyzfake"])
        assert spans[0].status == "unsupported"

    def test_window_respects_max_window_argument(self):
        # max_window=1 时应该只比对单一 token，不该产生跨 2 词以上的候选片语。
        headwords = {"a b": _word("a b")}
        with patch.object(R, "lookup_headwords_batch", return_value={}) as mock_hw, \
             patch.object(R, "lookup_attested_batch", return_value={}):
            R.corroborate_tokens(None, _TRIBE_ID, ["a", "b"], max_window=1)
        called_forms = mock_hw.call_args_list[0].args[2]
        assert "a b" not in called_forms


class TestCorroborateFullSentence:
    def test_punct_and_foreign_do_not_break_into_wrong_multi_token_span(self):
        # "blaq, kayal" 中間隔著逗號，"blaq" 跟 "kayal" 不該被當成相鄰候選
        # 片語去查表（即使剛好存在一個叫 "blaq kayal" 的詞條也不該命中）。
        headwords = {"blaq": _word("blaq", "好"), "kayal": _word("kayal", "說")}
        with patch.object(R, "lookup_headwords_batch", return_value=headwords), \
             patch.object(R, "lookup_attested_batch", return_value={}):
            spans = R.corroborate_full_sentence(None, _TRIBE_ID, "blaq, kayal")

        statuses = [(s.surface, s.status) for s in spans]
        assert statuses == [("blaq", "headword"), (", ", "punct"), ("kayal", "headword")]

    def test_foreign_content_counted_as_unsupported_not_punct(self):
        with patch.object(R, "lookup_headwords_batch", return_value={"blaq": _word("blaq")}), \
             patch.object(R, "lookup_attested_batch", return_value={}):
            spans = R.corroborate_full_sentence(None, _TRIBE_ID, "blaq 你好")

        foreign_spans = [s for s in spans if "你" in s.surface or "好" in s.surface]
        assert all(s.status == "unsupported" for s in foreign_spans)

    def test_expanded_result_length_matches_display_tokens(self):
        headwords = {"babaw nya'": _word("babaw nya'")}
        with patch.object(R, "lookup_headwords_batch", return_value=headwords), \
             patch.object(R, "lookup_attested_batch", return_value={}):
            spans = R.corroborate_full_sentence(None, _TRIBE_ID, "babaw nya' rgyax.")

        # 一個 2-token 的 span 要展開成 2 筆各自的結果，長度要跟
        # split_display_tokens 的片段數一致（前端逐一渲染，不需要處理
        # 變寬的合併儲存格）。
        assert len(spans) == len(lexicon.split_display_tokens("babaw nya' rgyax."))
        assert spans[0].status == spans[1].status == "headword"


class TestEscapeLike:
    def test_escapes_percent_and_underscore(self):
        assert R._escape_like("50%_off") == "50\\%\\_off"
