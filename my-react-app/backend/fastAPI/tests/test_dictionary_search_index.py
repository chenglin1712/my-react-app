"""O4～O6：辭典查詢改用族語級索引（名稱／中文釋義字典、預先排好的清單、預先算好的簡化名稱與開頭字母）。
結果必須與原本「逐筆掃描、每次重排」的寫法完全相同——這裡用隨機資料，把新做法與舊做法的原樣寫法逐筆對照。"""
import random
from unittest.mock import patch

import pytest

from fastAPI.routes.dictionary import ExplanationItem, WordResult
from fastAPI.routes.dictionary import search as S

_SYLLABLES = ["ba", "lay", "cyu", "x", "ma", "ki", "-", "'", "Ba", "uwah", "ngi", "lo"]
_GLOSSES = ["水", "火", "好", "很好", "山", "河", "人", None, "", "朋友"]


def _random_words(seed, n=300):
    rng = random.Random(seed)
    words = []
    for i in range(n):
        name = "".join(rng.choice(_SYLLABLES) for _ in range(rng.randint(1, 3)))
        if rng.random() < 0.3:
            name += str(rng.randint(1, 3))           # 數字結尾：simplify_tayal 會去掉
        if rng.random() < 0.1:
            name = None
        items = [
            ExplanationItem(chineseExplanation=rng.choice(_GLOSSES), category=[rng.choice(["a", "b"])])
            for _ in range(rng.choice([0, 1, 1, 2, 3]))
        ]
        words.append(WordResult(id=str(i), name=name, frequency=rng.choice([None, 0, 300, 900, 2000]), explanationItems=items))
    return words


# ----- 舊寫法（原樣保留，當作對照基準） -----
def _old_search(words, keyword):
    results, matched = [], []
    for word in words:
        if word.name == keyword:
            matched.append(S.simplify_tayal(word.name))
            results.append(word)
    return results, matched


def _old_search_by_chinese(words, keyword):
    words = sorted(words, key=lambda w: (w.name or "").lower())
    results, matched = [], []
    for word in words:
        for defin in (word.explanationItems or []):
            if defin.chineseExplanation == keyword:
                matched.append(S.simplify_tayal(word.name))
                results.append(word)
                break
    return results, matched


def _old_fuzzy(words, keyword, exclude):
    out = {}
    for word in words:
        if S.simplify_tayal(word.name) in exclude:
            continue
        if keyword in (word.name or ""):
            out.setdefault(word.name, []).append(word)
    return out


def _old_fuzzy_chinese(words, keyword, exclude):
    out = {}
    for word in words:
        if S.simplify_tayal(word.name) in exclude:
            continue
        for defin in (word.explanationItems or []):
            if keyword in (defin.chineseExplanation or ""):
                out.setdefault(defin.chineseExplanation, []).append(word)
    return out


def _old_search_all(words, letter=None, frequency=None, category=None, favorites_only=False,
                    favorite_names=None, sort_order="asc", limit=None, offset=0):
    fav = set(favorite_names or [])
    filtered = [
        wr for wr in words
        if wr.explanationItems
        and (not letter or (wr.name or "").lower().startswith(letter.lower()))
        and (not frequency or S._frequency_bucket(wr.frequency) == frequency)
        and S._matches_category(wr, category)
        and (not favorites_only or wr.name in fav)
    ]
    ordered = S._sort_words(filtered, sort_order)
    page = ordered[offset:offset + limit] if limit is not None else ordered[offset:]
    return [[wr] for wr in page], len(ordered)


def _old_letters(words):
    letters = set()
    for wr in words:
        if not wr.explanationItems:
            continue
        first = (wr.name or "")[:1].lower()
        if first and (first.isalpha() or first in ("'", "’", "ʼ")):
            letters.add(first)
    return sorted(letters)


@pytest.fixture(params=[1, 2, 3])
def words(request):
    data = _random_words(request.param)
    S._tribe_index_cache.clear()
    with patch.object(S, "_load_tribe_words", return_value=data):
        yield data
    S._tribe_index_cache.clear()


def _same(a, b):
    """比較「同一批詞條物件、同樣順序」（用 is，不只看欄位相等）。"""
    assert len(a) == len(b)
    assert all(x is y for x, y in zip(a, b))


def test_exact_search_matches_the_linear_scan(words):
    for keyword in {w.name for w in words if w.name}.union({"nothere"}):
        got, got_names = S.search(None, keyword)
        want, want_names = _old_search(words, keyword)
        _same(got, want)
        assert got_names == want_names


def test_exact_chinese_search_matches_the_sort_then_scan(words):
    for keyword in _GLOSSES + ["不存在"]:
        got, got_names = S.search_by_chinese(None, keyword)
        want, want_names = _old_search_by_chinese(words, keyword)
        _same(got, want)
        assert got_names == want_names


def test_fuzzy_searches_match_the_scan_with_a_list_or_set_of_exclusions(words):
    exclude = [S.simplify_tayal(w.name) for w in words[:40]]
    for keyword in ["ba", "x", "好", "水", "", "zzz"]:
        for excl in (exclude, []):
            got = S.fuzzy_search(None, keyword, excl)
            want = _old_fuzzy(words, keyword, excl)
            assert list(got) == list(want)
            for k in want:
                _same(got[k], want[k])
            got_c = S.fuzzy_search_by_chinese(None, keyword, excl)
            want_c = _old_fuzzy_chinese(words, keyword, excl)
            assert list(got_c) == list(want_c)
            for k in want_c:
                _same(got_c[k], want_c[k])


@pytest.mark.parametrize("sort_order", ["asc", "desc"])
def test_search_all_matches_filter_then_sort_for_many_filter_combinations(words, sort_order):
    rng = random.Random(7)
    names = [w.name for w in words if w.name]
    for _ in range(40):
        kwargs = dict(
            letter=rng.choice([None, "b", "c", "-", "'", "x"]),
            frequency=rng.choice([None, 1, 3, 5]),
            category=rng.choice([None, "a", "b"]),
            favorites_only=rng.random() < 0.4,
            favorite_names=rng.sample(names, 60),
            sort_order=sort_order,
            limit=rng.choice([None, 10, 50]),
            offset=rng.choice([0, 5, 50]),
        )
        got, got_total = S.search_all(None, tribe="泰雅語", **kwargs)
        want, want_total = _old_search_all(words, **kwargs)
        assert got_total == want_total
        got_flat = [v[0] for v in got.values()]
        _same(got_flat, [v[0] for v in want])


def test_available_letters_match_the_scan(words):
    assert S.available_initial_letters(None, "泰雅語") == _old_letters(words)


def test_index_is_built_once_per_word_list_and_rebuilt_for_a_new_list():
    first_list = _random_words(1, 50)
    S._tribe_index_cache.clear()
    with patch.object(S, "_load_tribe_words", return_value=first_list):
        a = S._index_for(None, "泰雅語")
        assert S._index_for(None, "泰雅語") is a
    with patch.object(S, "_load_tribe_words", return_value=list(first_list)):  # 快取重載：新的清單物件
        assert S._index_for(None, "泰雅語") is not a
    S._tribe_index_cache.clear()
