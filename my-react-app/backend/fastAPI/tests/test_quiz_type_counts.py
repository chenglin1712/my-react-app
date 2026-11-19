"""測驗題型配額（F15）。

總題數很小（後台可設 1 到 50）時，四種題型各自四捨五入後的總和可能比總題數多
（例如總題數 3，能力值偏低：四種題型各進位成 1 題，共 4 題）。
以前是照多的題數全部出完，再把洗牌後的最後幾題截掉，結果哪個題型被砍是隨機的。
現在在配額階段就扣掉多的，總和一定剛好等於總題數。
"""
from unittest.mock import patch

import pytest

from fastAPI.routes.quiz import irt
from fastAPI.routes.quiz.irt import _compute_type_counts

LOW = 0.3     # theta < 0.7
HIGH = 0.9    # theta >= 0.7
RATIOS = {
    LOW: {"wordTranslate": 0.3, "wordMatch": 0.2, "sentenceFill": 0.25, "sentenceOrder": 0.25},
    HIGH: {"wordTranslate": 0.2, "wordMatch": 0.1, "sentenceFill": 0.3, "sentenceOrder": 0.4},
}


def _counts(total, theta):
    with patch.object(irt, "TOTAL_QUESTIONS", total):
        return _compute_type_counts(theta)


def _old_counts(total, theta):
    """修正前的算法（參照用）：四捨五入，不足的補給單詞翻譯題；總和超過時不處理。"""
    r = RATIOS[theta]
    counts = {name: round(total * ratio) for name, ratio in r.items()}
    assigned = sum(counts.values())
    if assigned < total:
        counts["wordTranslate"] += total - assigned
    return counts


@pytest.mark.parametrize("theta", [LOW, HIGH])
@pytest.mark.parametrize("total", range(1, 51))
def test_the_counts_always_add_up_to_exactly_the_total(total, theta):
    counts = _counts(total, theta)
    assert sum(counts.values()) == total
    assert all(isinstance(n, int) and n >= 0 for n in counts.values())
    assert set(counts) == {"wordTranslate", "wordMatch", "sentenceFill", "sentenceOrder"}


# 修正前會超過總題數的 (總題數, 能力) 組合；只對這些組合檢查「扣掉多的之後仍貼近理想配額」
OVERFLOWING = [(t, th) for th in (LOW, HIGH) for t in range(1, 51) if sum(_old_counts(t, th).values()) > t]


def test_the_overflowing_totals_are_the_ones_we_expect():
    """已知的溢出案例確實存在，否則下面那條參數化測試會變成空的而沒人發現。"""
    assert (3, LOW) in OVERFLOWING and (6, LOW) in OVERFLOWING
    assert (9, HIGH) in OVERFLOWING and (19, HIGH) in OVERFLOWING


@pytest.mark.parametrize("total,theta", OVERFLOWING)
def test_an_overflowing_total_is_trimmed_without_straying_far_from_the_ideal_share(total, theta):
    """原本會超過總題數的情況：扣掉多的之後，每個題型仍然離理想配額不到 1 題。
    （原本就不足的情況，缺的題數照舊補給單詞翻譯題，不在這條範圍內。）"""
    counts = _counts(total, theta)
    for name, ratio in RATIOS[theta].items():
        assert abs(counts[name] - total * ratio) < 1.0 + 1e-9, (total, theta, name, counts)


@pytest.mark.parametrize("theta", [LOW, HIGH])
@pytest.mark.parametrize("total", range(1, 51))
def test_totals_that_already_fit_are_unchanged(total, theta):
    """以前就剛好或不足的情況，結果跟修正前完全一樣（尤其預設 10 題的分配）。"""
    old = _old_counts(total, theta)
    if sum(old.values()) <= total:
        assert _counts(total, theta) == old


def test_the_default_ten_question_split_is_unchanged():
    assert _counts(10, LOW) == {"wordTranslate": 4, "wordMatch": 2, "sentenceFill": 2, "sentenceOrder": 2}
    assert _counts(10, HIGH) == {"wordTranslate": 2, "wordMatch": 1, "sentenceFill": 3, "sentenceOrder": 4}


def test_three_questions_at_low_ability_drops_the_type_that_rounded_up_the_most():
    # 理想配額 0.9／0.6／0.75／0.75，四捨五入都變 1；單詞配對被進位最多（0.4），所以讓出去。
    assert _counts(3, LOW) == {"wordTranslate": 1, "wordMatch": 0, "sentenceFill": 1, "sentenceOrder": 1}


def test_ties_give_up_the_later_type():
    # 總題數 6、能力低：理想配額 1.8／1.2／1.5／1.5 → 2／1／2／2 共 7；
    # 句子填空與句子排序同樣多進位 0.5，扣後面的句子排序。
    assert _counts(6, LOW) == {"wordTranslate": 2, "wordMatch": 1, "sentenceFill": 2, "sentenceOrder": 1}


def test_the_result_is_deterministic():
    assert all(_counts(3, LOW) == _counts(3, LOW) for _ in range(20))


def test_a_total_of_one_gives_exactly_one_question():
    assert sum(_counts(1, LOW).values()) == 1
    assert sum(_counts(1, HIGH).values()) == 1
