"""O1～O3：出題與作答路徑上的效能修正，行為必須與舊寫法相同。"""
import random

from fastAPI.routes.quiz import generator as G
from fastAPI.routes.quiz import irt
from fastAPI.routes.quiz.schemas import WordDTO


def _words(n):
    return [WordDTO(id=f"w{i}", name=f"name{i}", frequency=i % 50) for i in range(n)]


# ---------------- O1 ----------------

def test_freq_map_for_matches_the_plain_computation():
    words = _words(200)
    assert irt.normalized_freq_map_for("t1", words) == irt.compute_normalized_freq_map(words)


def test_freq_map_for_reuses_the_result_for_the_same_word_list_and_recomputes_for_a_new_one():
    words = _words(50)
    first = irt.normalized_freq_map_for("t2", words)
    assert irt.normalized_freq_map_for("t2", words) is first        # 同一份詞庫：不重算

    reloaded = _words(60)                                            # 詞庫快取失效重載 → 新的清單物件
    second = irt.normalized_freq_map_for("t2", reloaded)
    assert second is not first
    assert len(second) == 60


def test_freq_map_values_are_normalised_by_the_largest_log_frequency():
    words = [WordDTO(id="a", name="a", frequency=0), WordDTO(id="b", name="b", frequency=99)]
    freq = irt.compute_normalized_freq_map(words)
    assert freq["a"] == 0.0
    assert freq["b"] == 1.0
    assert irt.compute_normalized_freq_map([]) == {}


# ---------------- O2 ----------------

def test_sample_others_returns_k_distinct_words_without_the_excluded_names():
    words = _words(500)
    for seed in range(50):
        random.seed(seed)
        got = G._sample_others(words, {"name7"}, 3)
        assert len(got) == 3
        assert len({o.name for o in got}) == 3
        assert all(o.name != "name7" for o in got)


def test_sample_others_handles_small_and_degenerate_lists():
    words = _words(3)
    assert {o.name for o in G._sample_others(words, {"name0"}, 3)} == {"name1", "name2"}  # 不足 k 個：全部回傳
    assert G._sample_others([], set(), 3) == []
    assert G._sample_others(words, set(), 0) == []
    assert G._sample_others(words, {w.name for w in words}, 3) == []                       # 全被排除


def test_sample_others_still_finds_candidates_when_almost_everything_is_excluded():
    words = _words(1000)
    exclude = {w.name for w in words[:-2]}   # 只剩最後兩個可選
    for seed in range(20):
        random.seed(seed)
        assert {o.name for o in G._sample_others(words, exclude, 3)} == {"name998", "name999"}


def test_translate_options_contain_the_answer_plus_three_distractors():
    words = _words(100)
    for w in words[:20]:
        correct, opts = G._build_translate_options(w, words)
        assert correct in opts
        assert len(opts) == 4


# ---------------- O3 ----------------

def test_score_candidates_shares_one_type_stats_table_and_scores_every_word():
    words = _words(30)
    user_model = {"user_errors": {}, "favorites": {}, "explorations": {},
                  "type_stats": {"word-translate": {"e": 2, "n": 5}, "sentence-fill": {"e": 0, "n": 0}}}
    fprime = irt.compute_normalized_freq_map(words)
    candidates = G._score_candidates(words, user_model, 0.5, 1.0, fprime)

    assert len(candidates) == 30
    expected = {t: irt.compute_smoothed_error_rate(s["e"], s["n"]) for t, s in user_model["type_stats"].items()}
    assert all(c["Dt_map"] == expected for c in candidates)
    scores = [c["Score"] for c in candidates]
    assert scores == sorted(scores, reverse=True)
