"""各族語收藏數（/api/v1/dictionary/favorites-summary/ 背後的 count_words_by_tribe）。

收藏資料只存詞名、不分族語，頁面要顯示「每個族語各收藏幾個詞」就得由後端對照各族語的詞條。
這裡 monkeypatch _load_tribe_words 回傳固定假資料，只驗證統計邏輯，不需要連資料庫。
"""
import pytest
from pydantic import ValidationError
from unittest.mock import patch

from fastAPI.routes.dictionary import (
    ExplanationItem,
    FavoriteCountsRequest,
    WordResult,
    count_words_by_tribe,
)


def _word(name, has_explanation=True):
    items = [ExplanationItem(chineseExplanation="示意釋義")] if has_explanation else []
    return WordResult(name=name, explanationItems=items)


WORDS_BY_TRIBE = {
    "泰雅語": [_word("balay"), _word("cyux"), _word("balay")],  # balay 有兩筆詞條
    "阿美語": [_word("balay"), _word("no-explanation", has_explanation=False)],
    "布農語": [_word("other")],
    "葛瑪蘭語": [],
    "排灣語": [_word("cyux")],
}


def _fake_load(db, tribe):
    return WORDS_BY_TRIBE[tribe]


@patch("fastAPI.routes.dictionary.search._load_tribe_words", side_effect=_fake_load)
def test_counts_each_tribe_by_cards(_mock):
    counts = count_words_by_tribe(None, ["balay", "cyux"])
    # 泰雅：balay 兩筆＋cyux 一筆；一筆詞條算一張字卡，跟收藏頁顯示的卡片數一致
    assert counts == {"tayal": 3, "amis": 1, "bunun": 0, "kavalan": 0, "paiwan": 1}


@patch("fastAPI.routes.dictionary.search._load_tribe_words", side_effect=_fake_load)
def test_words_without_explanation_are_not_counted(_mock):
    counts = count_words_by_tribe(None, ["no-explanation"])
    assert counts["amis"] == 0


@patch("fastAPI.routes.dictionary.search._load_tribe_words", side_effect=_fake_load)
def test_empty_names_returns_zero_for_all_tribes_without_loading(mock_load):
    counts = count_words_by_tribe(None, [])
    assert counts == {"tayal": 0, "amis": 0, "bunun": 0, "kavalan": 0, "paiwan": 0}
    mock_load.assert_not_called()


class TestFavoriteCountsRequest:
    def test_defaults_to_empty(self):
        assert FavoriteCountsRequest().names == []

    def test_rejects_too_many_names(self):
        with pytest.raises(ValidationError):
            FavoriteCountsRequest(names=["a"] * 2001)

    def test_rejects_name_too_long(self):
        with pytest.raises(ValidationError):
            FavoriteCountsRequest(names=["x" * 101])

    def test_rejects_names_as_string(self):
        with pytest.raises(ValidationError):
            FavoriteCountsRequest(names="balay")
