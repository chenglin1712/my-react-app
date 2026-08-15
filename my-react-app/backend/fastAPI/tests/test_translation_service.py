"""fastAPI.routes.translation.service 的編排邏輯測試——語料短路判斷、LLM
回應解析防禦、confidence 計算、錯誤分類。Mock 掉所有會碰 DB／呼叫外部 LLM
API 的邊界（retrieve.retrieve_for_zh／retrieve_for_tribe／
corroborate_full_sentence、service._call_llm），只測純編排邏輯。
"""
from unittest.mock import patch

import pytest

from fastAPI.routes.translation import retrieve as R
from fastAPI.routes.translation import service as S


def _sentence(id_, original, chinese, score=1.0):
    return R.SentenceMatch(id=id_, original=original, chinese=chinese, audio_file_id=None, score=score)


class TestExactCorpusShortcut:
    def test_zh2tribe_short_circuits_without_calling_llm(self):
        retrieval = R.ZhRetrieval(sentences=[_sentence(1, "blaq kayal nya' soni'.", "今天天氣很好。")], words=[])
        with patch.object(R, "retrieve_for_zh", return_value=retrieval), \
             patch.object(S, "_get_strip_rules", return_value=None), \
             patch.object(R, "corroborate_full_sentence", return_value=[]), \
             patch.object(S, "_call_llm") as mock_llm:
            result = S._translate_zh2tribe(None, "tid", "tayal", "泰雅語", "今天天氣很好")

        mock_llm.assert_not_called()
        assert result.match_type == "exact_corpus"
        assert result.model_used is None
        assert result.translation == "blaq kayal nya' soni'."

    def test_tribe2zh_short_circuits_without_calling_llm(self):
        retrieval = R.TribeRetrieval(
            tokens=[R.MatchedSpan(surface="blaq", token_count=1, status="headword")],
            sentences=[_sentence(1, "blaq kayal nya' soni'.", "今天天氣很好。")],
        )
        with patch.object(S, "_get_strip_rules", return_value=None), \
             patch.object(R, "retrieve_for_tribe", return_value=retrieval), \
             patch.object(S, "_call_llm") as mock_llm:
            result = S._translate_tribe2zh(None, "tid", "tayal", "泰雅語", "blaq kayal nya' soni'.")

        mock_llm.assert_not_called()
        assert result.match_type == "exact_corpus"
        assert result.translation == "今天天氣很好。"

    def test_dissimilar_sentence_does_not_short_circuit(self):
        # Jaccard 相似度不夠高時必須真的呼叫 LLM，不能因為檢索到「某個」句子
        # 就當作找到完全相同的句子。
        retrieval = R.ZhRetrieval(sentences=[_sentence(1, "mkilux balay kayal soni.", "今天天氣很熱。")], words=[])
        with patch.object(R, "retrieve_for_zh", return_value=retrieval), \
             patch.object(S, "_get_strip_rules", return_value=None), \
             patch.object(R, "corroborate_full_sentence", return_value=[]), \
             patch.object(S, "_call_llm", return_value='{"translation":"x","note":""}') as mock_llm:
            S._translate_zh2tribe(None, "tid", "tayal", "泰雅語", "今天天氣如何")

        mock_llm.assert_called_once()


class TestParseLlmJson:
    def test_valid_json(self):
        parsed = S._parse_llm_json('{"translation": "blaq", "note": "ok"}')
        assert parsed == {"translation": "blaq", "note": "ok"}

    def test_strips_code_fence(self):
        parsed = S._parse_llm_json('```json\n{"translation": "blaq", "note": ""}\n```')
        assert parsed["translation"] == "blaq"

    def test_malformed_json_returns_none(self):
        assert S._parse_llm_json("not json at all") is None

    def test_non_string_translation_field_rejected(self):
        # 曾經是真的 bug：只驗證了能被 json.loads() 解析，沒驗證欄位型別；
        # 模型回傳 translation 是陣列時，非字串值會一路帶進後面的 regex
        # 切詞，直接丟 TypeError，變成整支請求 500。
        assert S._parse_llm_json('{"translation": ["a", "b"], "note": ""}') is None

    def test_non_string_note_field_rejected(self):
        assert S._parse_llm_json('{"translation": "blaq", "note": 123}') is None

    def test_non_dict_json_rejected(self):
        assert S._parse_llm_json('["a", "b"]') is None


class TestConfidenceFromCoverage:
    def test_full_coverage_is_high(self):
        cov = S.Coverage(total=3, headword=3, attested=0, derived=0, unsupported=0, corroborated_ratio=1.0)
        assert S._confidence_from_coverage(cov) == "high"

    def test_partial_coverage_is_medium(self):
        cov = S.Coverage(total=4, headword=2, attested=0, derived=0, unsupported=2, corroborated_ratio=0.5)
        assert S._confidence_from_coverage(cov) == "medium"

    def test_mostly_unsupported_is_low(self):
        cov = S.Coverage(total=4, headword=1, attested=0, derived=0, unsupported=3, corroborated_ratio=0.25)
        assert S._confidence_from_coverage(cov) == "low"


class TestBuildWarning:
    def test_no_warning_when_fully_supported(self):
        cov = S.Coverage(total=3, headword=3, attested=0, derived=0, unsupported=0, corroborated_ratio=1.0)
        assert S._build_warning(cov) is None

    def test_warning_mentions_counts(self):
        cov = S.Coverage(total=3, headword=2, attested=0, derived=0, unsupported=1, corroborated_ratio=0.667)
        assert S._build_warning(cov) == "本翻譯有 1/3 個詞無語料佐證"


class TestTranslateValidation:
    def test_unsupported_tribe_raises(self):
        with pytest.raises(S.UnsupportedTribeError):
            S.translate(None, "not-a-real-tribe", "zh2tribe", "hello")

    def test_unsupported_direction_raises(self):
        with patch.object(S, "_translate_zh2tribe"), patch.object(S, "_translate_tribe2zh"):
            with pytest.raises(S.UnsupportedDirectionError):
                S.translate(None, "tayal", "sideways", "hello")
