"""search_all()（單字查詢頁 /api/v1/dictionary/all/ 背後的邏輯）效能修正的行為驗證。

原本每次呼叫都重新查整個 tribe 的 Word + 逐一批次查 sources/audio/explanation 再組成
WordResult（實測泰雅語 6,202 筆詞約 11.7 秒），改成沿用 search()/fuzzy_search() 等既有
_load_tribe_words() tribe 級快取後，篩選/排序/分頁的邏輯不能跟著改掉——這裡直接
monkeypatch fastAPI.routes.dictionary.search._load_tribe_words 回傳固定的假資料，
只驗證 search_all 在快取之上做的篩選/排序/分頁行為，不需要真的連資料庫。
"""
from unittest.mock import patch

from fastAPI.routes.dictionary import search_all, WordResult, ExplanationItem


def _word(name, frequency=None, category=None, has_explanation=True):
    explanation_items = (
        [ExplanationItem(chineseExplanation="示意釋義", category=[category] if category else [])]
        if has_explanation else []
    )
    return WordResult(name=name, frequency=frequency, explanationItems=explanation_items)


FAKE_WORDS = [
    _word("balay", frequency=50, category="情緒思維"),   # 1 star
    _word("cyux", frequency=500, category="人物、身分"),  # 3 stars
    _word("empty-explanation", frequency=10, has_explanation=False),
    _word("-suffix", frequency=10),  # 非字母開頭，排序時應排最後
    _word("Zzz", frequency=900),  # 4 stars
]


@patch("fastAPI.routes.dictionary.search._load_tribe_words", return_value=FAKE_WORDS)
def test_excludes_words_without_explanation_items(mock_load):
    content, total = search_all(db=None, tribe="泰雅語")
    names = [v[0].name for v in content.values()]
    assert "empty-explanation" not in names
    assert total == len(FAKE_WORDS) - 1
    mock_load.assert_called_once_with(None, "泰雅語")


@patch("fastAPI.routes.dictionary.search._load_tribe_words", return_value=FAKE_WORDS)
def test_letter_filter(mock_load):
    content, total = search_all(db=None, tribe="泰雅語", letter="c")
    names = [v[0].name for v in content.values()]
    assert names == ["cyux"]
    assert total == 1


@patch("fastAPI.routes.dictionary.search._load_tribe_words", return_value=FAKE_WORDS)
def test_frequency_filter_maps_to_star_bucket(mock_load):
    # frequency=500 落在 3 星區間（401~800）
    content, total = search_all(db=None, tribe="泰雅語", frequency=3)
    names = [v[0].name for v in content.values()]
    assert names == ["cyux"]
    assert total == 1


@patch("fastAPI.routes.dictionary.search._load_tribe_words", return_value=FAKE_WORDS)
def test_category_filter(mock_load):
    content, total = search_all(db=None, tribe="泰雅語", category="人物、身分")
    names = [v[0].name for v in content.values()]
    assert names == ["cyux"]


@patch("fastAPI.routes.dictionary.search._load_tribe_words", return_value=FAKE_WORDS)
def test_favorites_only_filter(mock_load):
    content, total = search_all(
        db=None, tribe="泰雅語", favorites_only=True, favorite_names=["balay", "Zzz"]
    )
    names = {v[0].name for v in content.values()}
    assert names == {"balay", "Zzz"}


@patch("fastAPI.routes.dictionary.search._load_tribe_words", return_value=FAKE_WORDS)
def test_sort_order_and_non_alpha_prefix_goes_last(mock_load):
    content, _ = search_all(db=None, tribe="泰雅語", sort_order="asc")
    ordered_names = [content[str(i)][0].name for i in range(len(content))]
    # balay < cyux < Zzz（不分大小寫），非字母開頭的 -suffix 排最後
    assert ordered_names == ["balay", "cyux", "Zzz", "-suffix"]

    content_desc, _ = search_all(db=None, tribe="泰雅語", sort_order="desc")
    ordered_names_desc = [content_desc[str(i)][0].name for i in range(len(content_desc))]
    assert ordered_names_desc == list(reversed(ordered_names))


@patch("fastAPI.routes.dictionary.search._load_tribe_words", return_value=FAKE_WORDS)
def test_limit_offset_pagination_after_filter_and_sort(mock_load):
    # 篩選+排序後總共 4 筆（排除 empty-explanation）：balay, cyux, Zzz, -suffix
    first_page, total = search_all(db=None, tribe="泰雅語", limit=2, offset=0)
    assert [v[0].name for v in first_page.values()] == ["balay", "cyux"]
    assert total == 4

    second_page, total2 = search_all(db=None, tribe="泰雅語", limit=2, offset=2)
    assert [v[0].name for v in second_page.values()] == ["Zzz", "-suffix"]
    assert total2 == 4


@patch("fastAPI.routes.dictionary.search._load_tribe_words", return_value=FAKE_WORDS)
def test_no_filters_returns_all_with_explanations_ungrouped_by_index(mock_load):
    content, total = search_all(db=None, tribe="泰雅語")
    assert total == 4
    # 每個詞各自一組，key 是序號字串，不是舊版的 chineseExplanation
    assert set(content.keys()) == {"0", "1", "2", "3"}
    assert all(len(v) == 1 for v in content.values())
