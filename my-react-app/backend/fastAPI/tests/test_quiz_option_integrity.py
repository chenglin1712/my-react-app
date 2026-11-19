"""測驗選項的完整性（F1）：選項不能出現「未知」、不能重複，配對題的中文標籤也不能重複。

原本的問題：
- 查不到釋義的詞，中文被補成字串「未知」；干擾選項又是從整個詞庫抽詞再取中文，
  所以「未知」會變成選項，兩個以上就重複。
- 不同詞共用同一個中文意思（實際例子：qsya 與 qsya' 都是「水」）時，選項會重複，
  而重複的選項都等於正解，點哪個都算對。
- 配對題同理：畫面上兩顆相同標籤的按鈕，只有一顆算對。

這類問題是機率性的（要抽到那幾個詞才會發生），所以每個案例都用很多個亂數種子跑。
"""
import random

import pytest

from fastAPI.routes.quiz import generator as G
from fastAPI.routes.quiz import repository
from fastAPI.routes.quiz.schemas import WordDTO

SEEDS = range(200)


def _make_words(n):
    return [WordDTO(id=f"w{i}", name=f"name{i}", frequency=1) for i in range(n)]


def _install(monkeypatch, words, cn_by_index):
    """cn_by_index：{索引: 中文}；不在裡面的詞沒有釋義。"""
    cache = {words[i].id: [{"chineseExplanation": cn}] for i, cn in cn_by_index.items()}
    monkeypatch.setattr(repository, "_word_explanations_cache", cache)
    monkeypatch.setattr(repository, "_word_audios_cache", {})


def _messy_fixture(monkeypatch):
    """60 個詞：每 3 個有 1 個沒有釋義；其餘每 4 個共用同一個中文（模擬「水」有好幾個詞）。"""
    words = _make_words(60)
    cn = {}
    for i in range(60):
        if i % 3 == 0:
            continue                      # 沒有釋義
        cn[i] = f"意思{i // 4}"           # 同一組的詞共用中文
    _install(monkeypatch, words, cn)
    return words, cn


def test_get_real_cn_treats_missing_empty_and_blank_explanations_as_none(monkeypatch):
    words = _make_words(4)
    monkeypatch.setattr(repository, "_word_explanations_cache", {
        "w0": [{"chineseExplanation": "水"}],
        "w1": [{"chineseExplanation": "  火  "}],
        "w2": [{"chineseExplanation": "   "}],
        "w3": [{"chineseExplanation": None}],
    })
    assert repository._get_real_cn(words[0]) == "水"
    assert repository._get_real_cn(words[1]) == "火"          # 去頭尾空白，才不會因為空白而判成不同意思
    assert repository._get_real_cn(words[2]) is None
    assert repository._get_real_cn(words[3]) is None
    assert repository._get_real_cn(WordDTO(id="nope", name="x", frequency=1)) is None


@pytest.mark.parametrize("seed", SEEDS)
def test_translate_options_are_unique_real_and_contain_the_answer_once(monkeypatch, seed):
    random.seed(seed)
    words, cn = _messy_fixture(monkeypatch)
    for i in cn:                                              # 每個有釋義的詞都當一次正解
        built = G._build_translate_options(words[i], words)
        assert built is not None
        correct, opts = built
        assert correct == cn[i]
        assert len(opts) == 4
        assert len(set(opts)) == 4, f"選項重複：{opts}"
        assert opts.count(correct) == 1, f"正解出現不只一次：{opts}"
        assert "未知" not in opts


def test_no_question_when_the_answer_word_has_no_explanation(monkeypatch):
    words, cn = _messy_fixture(monkeypatch)
    no_cn_word = words[0]                                     # i % 3 == 0 → 沒有釋義
    assert 0 not in cn
    assert G._build_translate_options(no_cn_word, words) is None
    assert G._build_word_translate_question(no_cn_word, words, "wt-x-0") is None


def test_no_question_when_there_are_not_enough_distinct_distractors(monkeypatch):
    words = _make_words(6)
    # 6 個詞只有兩種中文：正解之外最多只湊得出 1 個不同的干擾選項
    _install(monkeypatch, words, {0: "水", 1: "水", 2: "水", 3: "火", 4: "火", 5: "火"})
    for seed in SEEDS:
        random.seed(seed)
        assert G._build_translate_options(words[0], words) is None


def test_distractors_still_found_when_random_sampling_keeps_missing(monkeypatch):
    """可用的干擾項只有 3 個、混在 1000 個沒有釋義的詞裡：隨機抽不到時要退回完整掃描。"""
    words = _make_words(1004)
    _install(monkeypatch, words, {0: "正解", 1: "甲", 2: "乙", 3: "丙"})
    for seed in range(30):
        random.seed(seed)
        built = G._build_translate_options(words[0], words)
        assert built is not None
        assert set(built[1]) == {"正解", "甲", "乙", "丙"}


@pytest.mark.parametrize("seed", SEEDS)
def test_generate_word_translate_questions_skips_unusable_words_and_still_fills_the_count(monkeypatch, seed):
    random.seed(seed)
    words, cn = _messy_fixture(monkeypatch)
    candidates = [{"word": w, "Dt_map": {}, "Dw": 0.5, "fprime": 0.0, "Bq": 0.0, "Score": 1.0} for w in words]
    picker = G._CandidatePicker(candidates)

    questions = G._generate_word_translate_questions(picker, words, 0.5, 5)

    assert len(questions) == 5                                # 沒有釋義的詞被略過、換下一個，數量照樣補滿
    assert len({q["id"] for q in questions}) == 5
    for q in questions:
        opts = q["payload"]["options"]
        assert len(set(opts)) == 4 and "未知" not in opts
        assert q["payload"]["answer"] in opts


@pytest.mark.parametrize("seed", SEEDS)
def test_word_match_labels_are_unique_and_real(monkeypatch, seed):
    random.seed(seed)
    words, cn = _messy_fixture(monkeypatch)
    candidates = [{"word": w, "Dt_map": {}, "Dw": 0.5, "fprime": 0.0, "Bq": 0.0, "Score": 1.0} for w in words]
    picker = G._CandidatePicker(candidates)

    questions = G._generate_word_match_questions(picker, 3)

    assert len(questions) == 3                                # 40 個有釋義的詞、15 種不同的意思：湊得出 3 組
    for q in questions:
        pairs = q["payload"]["pairs"]
        assert len(pairs) == 5
        labels = [p["cn"] for p in pairs]
        assert len(labels) == len(set(labels)), f"配對題標籤重複：{labels}"
        assert "未知" not in labels


def test_distinct_real_cns_dedupes_and_ignores_words_without_a_real_explanation(monkeypatch):
    words = _make_words(6)
    _install(monkeypatch, words, {0: "水", 1: "水", 2: "火", 3: " 水 "})   # 4、5 沒有釋義；3 去空白後也是「水」
    assert G._distinct_real_cns(words) == ["水", "火"]


def test_candidates_without_explanation_are_not_consumed_by_translate_and_match(monkeypatch):
    """前面 3000 個高分候選字都沒有釋義：單詞翻譯與配對題要跳過它們、而且不能把它們耗掉，
    不然後面的題型（句子填空、句子排序）沒有候選字可用。"""
    words = _make_words(3030)
    _install(monkeypatch, words, {i: f"意思{i}" for i in range(3000, 3030)})   # 只有最後 30 個有釋義
    candidates = [{"word": w, "Dt_map": {}, "Dw": 0.5, "fprime": 0.0, "Bq": 0.0, "Score": 1.0} for w in words]
    picker = G._CandidatePicker(candidates)

    wt = G._generate_word_translate_questions(picker, words, 0.5, 5)
    wm = G._generate_word_match_questions(picker, 2)

    assert len(wt) == 5 and len(wm) == 2
    first_unusable = picker.next()
    assert first_unusable is not None and first_unusable["word"].name == "name0"   # 沒有釋義的候選字原封不動


def test_translate_generation_gives_up_quickly_when_there_are_too_few_distinct_meanings(monkeypatch):
    """6500 個詞只有兩種中文意思：每個候選字都湊不出三個干擾選項。要立刻放棄，
    不能每個候選字都重掃一次詞庫（以前的寫法最壞是 6500 × 6500 次查詢）。"""
    words = _make_words(6500)
    _install(monkeypatch, words, {i: ("水" if i % 2 else "火") for i in range(6500)})
    candidates = [{"word": w, "Dt_map": {}, "Dw": 0.5, "fprime": 0.0, "Bq": 0.0, "Score": 1.0} for w in words]

    # 不用計時（機器忙的時候會誤判）：算查詢釋義的次數。建一次池子約一輪詞庫，加上少數常數次；
    # 以前每個候選字各掃一輪，次數會是 6500 × 6500。
    calls = {"n": 0}
    real = G._get_real_cn

    def counting(word):
        calls["n"] += 1
        return real(word)

    monkeypatch.setattr(G, "_get_real_cn", counting)

    questions = G._generate_word_translate_questions(G._CandidatePicker(candidates), words, 0.5, 5)

    assert questions == []
    assert calls["n"] < 3 * len(words)


def test_distractors_are_drawn_uniformly_over_distinct_meanings_not_over_words(monkeypatch):
    """一個意思有很多個詞時，不能因此更常被抽成干擾選項（以前是抽詞再取中文，會有這個偏差）。"""
    from collections import Counter
    words = _make_words(110)
    cn = {i: "常見" for i in range(100)}                       # 100 個詞都是「常見」
    cn.update({100 + j: f"少見{j}" for j in range(10)})        # 另外 10 個詞各自一種意思
    _install(monkeypatch, words, cn)
    pool = G._distinct_real_cns(words)
    random.seed(1)
    counts = Counter()
    for _ in range(3000):
        _, opts = G._build_translate_options(words[100], words, pool)   # 正解是「少見0」
        counts.update(o for o in opts if o != "少見0")
    # 11 種意思去掉正解剩 10 種，每種被抽中的機率應該相近；「常見」不該遠高於其他
    assert counts["常見"] < 1.4 * (sum(counts.values()) / 10)


def test_sentence_fill_and_order_fallbacks_skip_words_that_cannot_make_a_translate_question(monkeypatch):
    """備援用的單詞翻譯題做不出來時要略過，不能把 None 塞進題目清單。"""
    words = _make_words(6)
    _install(monkeypatch, words, {0: "水"})                    # 只有一個詞有釋義：湊不出干擾選項
    candidates = [{"word": w, "Dt_map": {}, "Dw": 0.5, "fprime": 0.0, "Bq": 0.0, "Score": 1.0} for w in words]

    fill = G._generate_sentence_fill_questions(G._CandidatePicker(candidates), words, 3)
    order = G._generate_sentence_order_questions(G._CandidatePicker(candidates), words, 3)

    assert all(q is not None for q in fill + order)
    assert not any(q["type"] == "word-translate" for q in fill + order)
