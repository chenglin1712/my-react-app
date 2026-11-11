"""O7／O8：干擾項詞庫的負快取，以及依規則種類預先排好的換詞綴候選池。"""
from types import SimpleNamespace
from unittest.mock import patch

from fastAPI.routes.quiz import distractors as D
from config import morphology as M


def _tribe(tid="tribe-x"):
    return SimpleNamespace(id=tid, full_name="測試語")


def test_a_tribe_without_enough_data_is_remembered_and_not_rebuilt_every_time():
    D.invalidate()
    with patch.object(D, "_build_kit", return_value=None) as build:
        assert D.get_kit(None, _tribe()) is None
        assert D.get_kit(None, _tribe()) is None
        assert D.get_kit(None, _tribe()) is None
    assert build.call_count == 1          # 以前每次出題都會再掃一遍
    D.invalidate()


def test_invalidate_lets_a_previously_insufficient_tribe_be_rebuilt():
    D.invalidate()
    sentinel_kit = SimpleNamespace(name="kit")
    with patch.object(D, "_build_kit", return_value=None):
        assert D.get_kit(None, _tribe("t1")) is None
    D.invalidate("t1")                     # 辭典／語料異動後的失效通知
    with patch.object(D, "_build_kit", return_value=sentinel_kit) as build:
        assert D.get_kit(None, _tribe("t1")) is sentinel_kit
        assert D.get_kit(None, _tribe("t1")) is sentinel_kit
    assert build.call_count == 1
    D.invalidate()


def test_a_build_failure_is_not_cached():
    D.invalidate()
    calls = []

    def flaky(db, tribe_id, full_name):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("db down")
        return None

    with patch.object(D, "_build_kit", side_effect=flaky):
        try:
            D.get_kit(None, _tribe("t2"))
        except RuntimeError:
            pass
        assert D.get_kit(None, _tribe("t2")) is None   # 暫時性失敗不算「資料不足」，下一次重試
    assert len(calls) == 2
    D.invalidate()


def test_swap_pool_equals_the_sorted_top_rules_of_each_kind_and_is_computed_once():
    rules = {}
    for i in range(12):
        rules[M.MorphRule("P", a=f"p{i}")] = 100 - i          # 12 條前綴規則
    rules[M.MorphRule("S", a="an")] = 500
    rules[M.MorphRule("I", a="in", k=1)] = 7
    kit = D.TribeKit(frozenset(), frozenset(), {}, rules, {})

    expected_prefix = tuple(sorted((r for r in rules if r.kind == "P"), key=lambda r: (-rules[r], r))[:D.MAX_SWAP_POOL])
    assert kit.swap_pool("P") == expected_prefix
    assert len(kit.swap_pool("P")) == D.MAX_SWAP_POOL
    assert kit.swap_pool("P") is kit.swap_pool("P")           # 第二次直接取同一份，不重排
    assert kit.swap_pool("S") == (M.MorphRule("S", a="an"),)
    assert kit.swap_pool("Z") == ()


def test_swap_candidates_still_use_the_pool_in_rank_order():
    rules = {M.MorphRule("P", a=a): n for a, n in (("ma", 50), ("pa", 40), ("pi", 30))}
    kit = D.TribeKit(frozenset(), frozenset(), {}, rules, {})
    got = D._swap_candidates(kit, "lolo", M.MorphRule("P", a="ma"))
    assert [rule.a for _, rule in got] == ["ma", "pa", "pi"]
    assert [cand for cand, _ in got] == ["malolo", "palolo", "pilolo"]
