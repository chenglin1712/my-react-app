"""config.translation_lexicon 的純函式測試——正規化、切詞、詞綴規則
過濾、剝除候選、四層分類。這個模組不碰 DB，所有測試都不需要任何 fixture。
模組原本放在 fastAPI/routes/translation/ 底下，因為零框架依賴且 Django 端
（rebuild_translation_attested_forms 指令）也要用，已搬到 backend/config
共用層（見 P4 review BE-6），測試檔案留在這裡沒有跟著搬，因為測的仍然是
翻譯功能會用到的行為。

正規化規則（normalize_token 統一 ʼ/ʾ 兩種變音符號撇號為 ASCII '、移除 ^）
已用全庫 30,684 筆 words.name 對照 SQL 端運算式索引做過交叉驗證（0 筆不
一致，見 alembic/versions/86d389a704d0_add_translation_support.py），這裡
只測代表性案例與邊界情況，不重複那個全量驗證。
"""
from config import translation_lexicon as lexicon


class TestNormalizeToken:
    def test_unifies_apostrophe_variants(self):
        assert lexicon.normalize_token("blaqʼ") == lexicon.normalize_token("blaq'")

    def test_strips_caret(self):
        assert lexicon.normalize_token("ʼaca^") == lexicon.normalize_token("ʼaca")

    def test_casefolds(self):
        assert lexicon.normalize_token("Blaq") == "blaq"

    def test_preserves_underscore_and_hyphen(self):
        # Tayal 用底線標記央中元音（b_yaring），連字號可能出現在詞條本身，
        # 兩者都是正字法一部分，不是要濾掉的標點。
        assert lexicon.normalize_token("b_yaring") == "b_yaring"


class TestNormalizePhrase:
    def test_joins_normalized_tokens_with_single_space(self):
        # 對應 words.name 裡 1,037 筆含空格的多詞詞條（如 "babaw nya'"）。
        assert lexicon.normalize_phrase(["babaw", "nya'"]) == "babaw nya'"
        assert lexicon.normalize_phrase(["Babaw", "Nyaʼ"]) == "babaw nya'"


class TestTokenize:
    def test_extracts_word_like_spans_only(self):
        assert lexicon.tokenize("blaq kayal nya' soni'.") == ["blaq", "kayal", "nya'", "soni'"]

    def test_drops_punctuation_only_fragments(self):
        # 曾經是真的 bug：TOKEN_RE 允許切出完全不含字母的片段（例如單獨一個
        # 撇號），rebuild_translation_attested_forms 因此把雜訊寫進
        # translation_attested_form（實測全庫 14,228 筆裡出現過 1 筆）。
        assert lexicon.tokenize("' - ^") == []

    def test_ignores_chinese_characters(self):
        assert lexicon.tokenize("qmuzi 掛") == ["qmuzi"]


class TestIsWordToken:
    def test_rejects_pure_symbol_pieces(self):
        assert lexicon.is_word_token("-") is False
        assert lexicon.is_word_token("'''") is False
        assert lexicon.is_word_token("^") is False

    def test_accepts_genuine_word_forms(self):
        assert lexicon.is_word_token("blaq") is True
        assert lexicon.is_word_token("nya'") is True


class TestClassifyDisplayPiece:
    def test_word(self):
        assert lexicon.classify_display_piece("blaq") == "word"

    def test_punct(self):
        assert lexicon.classify_display_piece(".") == "punct"
        assert lexicon.classify_display_piece("-") == "punct"

    def test_foreign_content_is_not_punct(self):
        # 模型意外夾雜的中文字/數字必須算 foreign（=> unsupported），不能
        # 被靜默歸類成 punct 而消失在佐證比例的分母之外。
        assert lexicon.classify_display_piece("你好") == "foreign"
        assert lexicon.classify_display_piece("123") == "foreign"


class TestSplitDisplayTokens:
    def test_round_trip_preserves_words_and_trailing_punct(self):
        tokens = lexicon.split_display_tokens("blaq kayal nya' soni'.")
        assert tokens == ["blaq", "kayal", "nya'", "soni'", "."]

    def test_drops_pure_whitespace_gaps(self):
        tokens = lexicon.split_display_tokens("blaq  kayal")
        assert tokens == ["blaq", "kayal"]

    def test_keeps_interior_punct_as_separate_piece(self):
        # 間隔片段（逗號 + 其後的空白）整段保留，不會被拆開或去除空白——
        # 只有「整段間隔純粹是空白」才會被捨棄，見 test_drops_pure_whitespace_gaps。
        tokens = lexicon.split_display_tokens("blaq, kayal")
        assert tokens == ["blaq", ", ", "kayal"]


class TestCharTrigramsAndJaccard:
    def test_short_string_degrades_to_single_gram(self):
        assert lexicon.char_trigrams("水") == {"水"}

    def test_identical_strings_have_jaccard_one(self):
        s = lexicon.char_trigrams("今天天氣很好")
        assert lexicon.jaccard(s, s) == 1.0

    def test_disjoint_strings_have_jaccard_zero(self):
        a = lexicon.char_trigrams("今天天氣很好")
        b = lexicon.char_trigrams("謝謝你的幫助")
        assert lexicon.jaccard(a, b) == 0.0

    def test_empty_input_is_zero_not_error(self):
        assert lexicon.jaccard(set(), lexicon.char_trigrams("abc")) == 0.0


class TestBuildStripRules:
    def test_filters_non_affix_shaped_rows(self):
        rows = [
            {"affix": "首音節重疊（CV-）", "function": "重疊"},
            {"affix": "部分重疊", "function": "重疊"},
            {"affix": "ta-…-aw", "function": "混合"},
            {"affix": "ni", "function": "沒有連字號標記形狀"},
        ]
        rules = lexicon.build_strip_rules(rows)
        assert rules.prefixes == []
        assert rules.suffixes == []
        assert rules.infixes == []

    def test_excludes_uppercase_schematic_placeholders(self):
        # "CV-" 是語言學記號（代表複製詞根第一個輔音+母音），不是字面前綴
        # "c"+"v"；真正的字面詞綴在這份語料裡一律小寫，用這個特徵區分。
        rows = [{"affix": "CV-", "function": "進行貌"}, {"affix": "m-", "function": "主事焦點"}]
        rules = lexicon.build_strip_rules(rows)
        assert len(rules.prefixes) == 1
        assert rules.prefixes[0].affix == "m"

    def test_classifies_by_shape_not_affix_type_field(self):
        # 刻意不傳 affix_type 欄位——分類只看 affix 字串頭尾有沒有連字號。
        rows = [
            {"affix": "m-", "function": "前綴"},
            {"affix": "-an", "function": "後綴"},
            {"affix": "-in-", "function": "中綴"},
        ]
        rules = lexicon.build_strip_rules(rows)
        assert [r.affix for r in rules.prefixes] == ["m"]
        assert [r.affix for r in rules.suffixes] == ["an"]
        assert [r.affix for r in rules.infixes] == ["in"]


class TestStripCandidates:
    def _rules(self):
        return lexicon.build_strip_rules([
            {"affix": "m-", "function": "主事焦點"},
            {"affix": "-in-", "function": "完成式"},
        ])

    def test_prefix_strip(self):
        cands = self._rules().strip_candidates("malaw")
        assert any(c.residue == "alaw" and c.kind == "prefix" for c in cands)

    def test_infix_strip_finds_interior_insertion(self):
        # s-in-alaw 這種插入模式：sinalaw 剝掉中綴 "in" 應該得到 "salaw"。
        cands = self._rules().strip_candidates("sinalaw")
        assert any(c.residue == "salaw" and c.kind == "infix" for c in cands)

    def test_infix_does_not_match_word_final_position(self):
        # 曾經是真的 bug：搜尋範圍多算了一格（min(5,...) 應為 min(4,...)），
        # 且沒排除中綴落在字尾的情況——"abcdein" 的 "in" 在字尾，是後綴的
        # 樣子，不該被中綴規則搶走。
        cands = self._rules().strip_candidates("abcdein")
        assert not any(c.kind == "infix" for c in cands)

    def test_residue_below_minimum_length_is_excluded(self):
        rules = lexicon.build_strip_rules([{"affix": "ma-", "function": "狀態"}])
        # "mai"剝掉 "ma-" 只剩 "i"，長度 1 < 最短殘餘門檻 3，不該產生候選。
        cands = rules.strip_candidates("mai")
        assert cands == []

    def test_reduplication_detected_without_any_affix_rule(self):
        rules = lexicon.build_strip_rules([])
        cands = rules.strip_candidates("bulbul")
        assert any(c.kind == "reduplication" and c.residue == "bul" for c in cands)
