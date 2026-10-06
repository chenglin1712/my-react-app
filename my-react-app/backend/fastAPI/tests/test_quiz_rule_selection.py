"""適性選題：依規則熟練度挑句子填空題的目標詞（config/rule_skill_model.choose_candidate、
routes/quiz/rule_selection.py、generator 的 rule_policy）。

要鎖住的行為：
- 熟練度估計低的規則較常被選中，但已熟練的規則仍保有最低權重；
- 探索只挑「資料還不夠」的規則；同一份測驗同一條規則最多 MAX_PER_RULE 題；
- 沒有合適候選時退回原本排序，跟旗標關閉時一模一樣；
- 測不到規則的詞（無明確規則、造不出干擾項、規則有歧義）不參與選擇。
"""
import random
from collections import Counter
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from config import morphology as M
from config import rule_skill_model as R
from dictionary_db.connect import get_db
from fastAPI.main import app
from fastAPI.routes import auth as auth_module
from fastAPI.routes.quiz import distractors as D
from fastAPI.routes.quiz import flags, generator, repository, rule_selection, rule_state_store
from fastAPI.routes.quiz import diagnosis as G
from fastAPI.routes.quiz.schemas import WordDTO
from fastAPI.tests.test_quiz_diagnosis import SECRET, _kit

MA, PA, PI = (M.MorphRule("P", a=a) for a in ("ma", "pa", "pi"))
ID = {name: R.rule_id("amis", "P", name) for name in ("ma", "pa", "pi")}


def _cand(rank, rule):
    return {"rank": rank, "rule": rule}


class TestChooseCandidate:
    def test_no_candidates_or_no_rules_returns_none(self):
        assert R.choose_candidate([], {}, {}, random.Random(1)) is None
        assert R.choose_candidate([_cand(0, None), _cand(1, None)], {}, {}, random.Random(1)) is None

    def test_rules_at_the_per_quiz_cap_are_excluded(self):
        cands = [_cand(0, ID["ma"]), _cand(1, ID["pa"])]
        counts = {ID["ma"]: R.MAX_PER_RULE}
        for seed in range(30):
            index, _ = R.choose_candidate(cands, {}, counts, random.Random(seed))
            assert index == 1
        assert R.choose_candidate(cands, {}, {ID["ma"]: R.MAX_PER_RULE, ID["pa"]: R.MAX_PER_RULE}, random.Random(1)) is None

    def test_just_below_the_cap_is_still_eligible(self):
        assert R.choose_candidate([_cand(0, ID["ma"])], {}, {ID["ma"]: R.MAX_PER_RULE - 1}, random.Random(1)) is not None

    def test_weak_rules_are_chosen_more_often_than_strong_ones(self):
        skills = {ID["ma"]: {"p": 0.9, "n": 20, "c": 19, "v": "v"}, ID["pa"]: {"p": 0.1, "n": 20, "c": 2, "v": "v"}}
        cands = [_cand(0, ID["ma"]), _cand(0, ID["pa"])]
        picks = Counter(R.choose_candidate(cands, skills, {}, random.Random(s), exploration_rate=0.0)[0] for s in range(2000))
        assert picks[1] > 2 * picks[0]
        assert picks[0] > 100               # 熟練的規則仍保有最低權重，不會完全不出

    def test_expected_weight_ratio(self):
        skills = {ID["ma"]: {"p": 0.9, "n": 20, "c": 19, "v": "v"}, ID["pa"]: {"p": 0.1, "n": 20, "c": 2, "v": "v"}}
        weak, strong = R.NEED_FLOOR + 0.9, R.NEED_FLOOR + 0.1
        picks = Counter(R.choose_candidate([_cand(0, ID["ma"]), _cand(0, ID["pa"])], skills, {}, random.Random(s),
                                           exploration_rate=0.0)[0] for s in range(6000))
        assert picks[1] / 6000 == pytest.approx(weak / (weak + strong), abs=0.03)

    def test_original_rank_still_matters(self):
        cands = [_cand(0, ID["ma"]), _cand(30, ID["ma"])]           # 同一條規則，排序差很多
        picks = Counter(R.choose_candidate(cands, {}, {}, random.Random(s), exploration_rate=0.0)[0] for s in range(2000))
        assert picks[0] > 3 * picks[1]

    def test_exploration_only_picks_rules_without_enough_data(self):
        skills = {ID["ma"]: {"p": 0.5, "n": R.MIN_OBS_FOR_ESTIMATE, "c": 3, "v": "v"}}     # ma 剛好夠資料
        cands = [_cand(0, ID["ma"]), _cand(1, ID["pa"])]                                   # pa 沒資料
        for seed in range(50):
            index, mode = R.choose_candidate(cands, skills, {}, random.Random(seed), exploration_rate=1.0)
            assert (index, mode) == (1, R.MODE_EXPLORE)

    def test_one_observation_short_of_enough_data_is_explorable(self):
        skills = {ID["ma"]: {"p": 0.5, "n": R.MIN_OBS_FOR_ESTIMATE - 1, "c": 2, "v": "v"}}
        index, mode = R.choose_candidate([_cand(0, ID["ma"])], skills, {}, random.Random(1), exploration_rate=1.0)
        assert (index, mode) == (0, R.MODE_EXPLORE)

    def test_exploration_falls_back_to_exploitation_when_everything_is_known(self):
        skills = {ID["ma"]: {"p": 0.5, "n": 9, "c": 4, "v": "v"}}
        index, mode = R.choose_candidate([_cand(0, ID["ma"])], skills, {}, random.Random(1), exploration_rate=1.0)
        assert (index, mode) == (0, R.MODE_EXPLOIT)

    def test_no_exploration_when_rate_is_zero(self):
        for seed in range(50):
            assert R.choose_candidate([_cand(0, ID["ma"])], {}, {}, random.Random(seed), exploration_rate=0.0)[1] == R.MODE_EXPLOIT

    def test_default_exploration_rate_is_applied(self):
        modes = Counter(R.choose_candidate([_cand(0, ID["ma"])], {}, {}, random.Random(s))[1] for s in range(4000))
        assert modes[R.MODE_EXPLORE] / 4000 == pytest.approx(R.EXPLORATION_RATE, abs=0.03)

    def test_rank_weight_decreases(self):
        assert R.rank_weight(0) == 1.0 and R.rank_weight(1) < 1.0 and R.rank_weight(10) < R.rank_weight(1)


class TestPicker:
    def _picker(self, n=5):
        words = [{"word": WordDTO(id=f"w{i}", name=f"w{i}", frequency=1)} for i in range(n)]
        return generator._CandidatePicker(words), words

    def test_peek_does_not_consume(self):
        picker, words = self._picker()
        assert picker.peek(3) == words[:3] and picker.peek(3) == words[:3]
        assert picker.next() is words[0]

    def test_peek_skips_used_and_respects_limit(self):
        picker, words = self._picker()
        picker.take(words[1])
        assert picker.peek(10) == [words[0], words[2], words[3], words[4]]
        assert picker.peek(2) == [words[0], words[2]] and picker.peek(0) == []

    def test_a_taken_candidate_is_gone_for_every_later_question_type_so_no_word_repeats_in_a_quiz(self):
        # 四種題型共用同一個 picker：適性選題挑走的字，後面的題型（例如句子排序）也不會再用到——
        # 這保證一份測驗裡沒有兩題考同一個字，代價是後面題型的候選池會跟著變（見 rule_selection.py 的說明）。
        picker, words = self._picker()
        picker.take(words[2])
        assert [picker.next()["word"].name for _ in range(4)] == ["w0", "w1", "w3", "w4"]
        assert picker.next() is None

    def test_next_still_skips_taken_head(self):
        picker, words = self._picker()
        picker.take(words[0])
        assert picker.next() is words[1]


# ---------------------------------------------------------------------------
# RulePolicy 與出題整合
# ---------------------------------------------------------------------------

WORDS = {"mafilo": ("filo", "ma"), "patala": ("tala", "pa"), "pikuru": ("kuru", "pi"), "mabelo": ("belo", "ma")}


def _world(extra_lexicon=()):
    """四個可出題的詞（兩個用 ma-）＋一些無規則的詞，各有一句例句。"""
    names = list(WORDS) + [f"plain{i}" for i in range(10)]
    words = [WordDTO(id=f"w{i}", name=n, frequency=1) for i, n in enumerate(names)]
    repository._word_explanations_cache.clear()
    repository._word_audios_cache.clear()
    for w in words:
        repository._word_audios_cache[w.id] = [{"fileId": f"a-{w.id}"}]
        repository._word_explanations_cache[w.id] = [{"chineseExplanation": "示範", "sentenceItems": [
            {"originalSentence": f"Ini {w.name} kako.", "chineseSentence": "中文", "audioItems": [{"fileId": "s"}]}]}]
    derived = {n: (root,) for n, (root, _) in WORDS.items()}
    lexicon = set(names) | {root for root, _ in WORDS.values()} | set(extra_lexicon)
    kit = _kit(lexicon=lexicon, derived=derived, rules={MA: 50, PA: 40, PI: 30})
    return words, kit


def _picker_for(words):
    return generator._CandidatePicker([{"word": w} for w in words])


class TestRulePolicy:
    def test_rule_of_identifies_testable_words_only(self):
        words, kit = _world()
        policy = rule_selection.RulePolicy(kit, "amis", {}, random.Random(1))
        assert policy.rule_of("mafilo") == ID["ma"] and policy.rule_of("patala") == ID["pa"]
        assert policy.rule_of("plain0") is None                     # 辭典沒標註詞根
        assert policy.rule_of("zzz") is None

    def test_rule_of_is_none_when_no_distractor_can_be_built(self):
        words, kit = _world()
        # 把 mafilo 所有可換詞綴都登錄成已知詞形 → 造不出干擾項 → 這題測不到規則
        blocked = _kit(lexicon=set(kit.lexicon) | {"pafilo", "pifilo"}, derived=kit.roots_by_derived, rules={MA: 50, PA: 40, PI: 30})
        assert rule_selection.RulePolicy(blocked, "amis", {}, random.Random(1)).rule_of("mafilo") is None

    def test_rule_of_is_none_for_ambiguous_rules(self):
        ta, at = M.MorphRule("P", a="ta"), M.MorphRule("I", a="at", k=1)
        kit = _kit(lexicon={"tatalo"}, derived={"tatalo": ("talo",)}, rules={ta: 50, at: 40, PA: 30})
        assert rule_selection.RulePolicy(kit, "amis", {}, random.Random(1)).rule_of("tatalo") is None

    def test_rule_of_swallows_errors(self):
        words, kit = _world()
        policy = rule_selection.RulePolicy(kit, "amis", {}, random.Random(1))
        with patch.object(D, "recover_rule_detail", side_effect=RuntimeError("boom")):
            assert policy.rule_of("mafilo") is None

    def test_the_pre_check_never_consumes_the_selection_rng(self):
        # 預檢要看「造不造得出干擾項」，那個函式會洗牌；不能因此消耗選題用的亂數，
        # 否則每個候選有幾條可換的規則會悄悄改變選題分布，也讓固定種子的結果不可重現。
        words, kit = _world()
        rng = random.Random(42)
        before = rng.getstate()
        policy = rule_selection.RulePolicy(kit, "amis", {}, rng)
        for name in ("mafilo", "patala", "pikuru", "mabelo", "plain0"):
            policy.rule_of(name)
        assert rng.getstate() == before

    def test_selection_is_reproducible_with_a_fixed_seed_regardless_of_precheck_cost(self):
        words, kit = _world()
        picks = []
        for extra_rules in (False, True):
            rules = {MA: 50, PA: 40, PI: 30}
            if extra_rules:                       # 多幾條可換的規則：預檢要洗的牌變多，但選題結果不該變
                rules.update({M.MorphRule("P", a="ka"): 20, M.MorphRule("P", a="sa"): 15})
            k = _kit(lexicon=set(kit.lexicon), derived=kit.roots_by_derived, rules=rules)
            policy = rule_selection.RulePolicy(k, "amis", {}, random.Random(7))
            picks.append(policy.pick(_picker_for(words))[0]["word"].name)
        assert picks[0] == picks[1]

    def test_rule_of_is_cached(self):
        words, kit = _world()
        policy = rule_selection.RulePolicy(kit, "amis", {}, random.Random(1))
        with patch.object(D, "recover_rule_detail", wraps=D.recover_rule_detail) as spy:
            policy.rule_of("mafilo"); policy.rule_of("mafilo")
        assert spy.call_count == 1

    def test_pick_takes_the_candidate_and_names_the_policy(self):
        words, kit = _world()
        picker = _picker_for(words)
        policy = rule_selection.RulePolicy(kit, "amis", {}, random.Random(1))
        cand, rule, name = policy.pick(picker)
        assert cand["word"].name in WORDS and rule == G.rule_id_for("amis", {"ma": MA, "pa": PA, "pi": PI}[WORDS[cand["word"].name][1]])
        assert name in ("adaptive-explore", "adaptive-exploit")
        assert cand not in picker.peek(100)

    def test_pick_returns_none_when_nothing_is_testable(self):
        words, kit = _world()
        picker = _picker_for([w for w in words if w.name.startswith("plain")])
        assert rule_selection.RulePolicy(kit, "amis", {}, random.Random(1)).pick(picker) is None
        assert len(picker.peek(100)) == 10                              # 什麼都沒被取走

    def test_commit_counts_toward_the_cap(self):
        words, kit = _world()
        policy = rule_selection.RulePolicy(kit, "amis", {}, random.Random(1))
        policy.commit(None)
        assert policy.rule_counts == {}
        policy.commit(ID["ma"]); policy.commit(ID["ma"])
        assert policy.rule_counts == {ID["ma"]: R.MAX_PER_RULE}

    def test_only_candidates_inside_the_lookahead_window_are_considered(self):
        words, kit = _world()
        # 可出題的詞排在 plain 後面很遠：視窗只有 3，看不到
        ordered = [w for w in words if w.name.startswith("plain")] + [w for w in words if w.name in WORDS]
        policy = rule_selection.RulePolicy(kit, "amis", {}, random.Random(1), lookahead=3)
        assert policy.pick(_picker_for(ordered)) is None
        wide = rule_selection.RulePolicy(kit, "amis", {}, random.Random(1), lookahead=20)
        assert wide.pick(_picker_for(ordered)) is not None


class TestGeneratorWithPolicy:
    def _run(self, words, kit, skills, count=3, seed=1, token=True):
        policy = rule_selection.RulePolicy(kit, "amis", skills, random.Random(seed))
        source = D.DistractorSource(kit)
        qs = generator._generate_sentence_fill_questions(
            _picker_for(words), words, count, distractor_source=source,
            token_options=generator.TokenOptions("amis", "u1") if token else None, rule_policy=policy)
        return qs, policy

    @pytest.fixture(autouse=True)
    def _secret(self, monkeypatch):
        monkeypatch.setenv(G.SECRET_ENV, SECRET)

    def test_weak_rule_is_preferred_over_the_baseline_order(self):
        words, kit = _world()
        # 基準排序把 plain 詞放最前面；pa- 很弱、ma-/pi- 很熟 → 前 3 題應該多半是 patala
        skills = {ID["ma"]: {"p": 0.95, "n": 30, "c": 29, "v": "v"}, ID["pi"]: {"p": 0.95, "n": 30, "c": 29, "v": "v"},
                  ID["pa"]: {"p": 0.05, "n": 30, "c": 1, "v": "v"}}
        ordered = [w for w in words if w.name.startswith("plain")] + [w for w in words if w.name in WORDS]
        hits = 0
        for seed in range(60):
            qs, _ = self._run(ordered, kit, skills, count=1, seed=seed)
            hits += qs[0]["payload"]["tayal"]["word"] == "patala"
        assert hits > 25                                    # 基準排序下一次都不會選到

    def test_same_rule_never_exceeds_the_cap_in_one_quiz(self):
        words, kit = _world()
        skills = {ID["ma"]: {"p": 0.0, "n": 30, "c": 0, "v": "v"}}      # ma- 最弱 → 想一直出 ma-
        for seed in range(40):
            qs, _ = self._run(words, kit, skills, count=4, seed=seed)
            rules = Counter(G.decode_token(q["payload"]["questionToken"]).target_rule_id for q in qs)
            assert rules[ID["ma"]] <= R.MAX_PER_RULE

    def test_tokens_record_the_selection_policy(self):
        words, kit = _world()
        qs, _ = self._run(words, kit, {}, count=3)
        policies = {G.decode_token(q["payload"]["questionToken"]).policy for q in qs}
        assert policies <= {"adaptive-explore", "adaptive-exploit", "adaptive-fallback"} and policies

    def test_fallback_policy_when_nothing_testable_is_left(self):
        words, kit = _world()
        # 只剩無規則的詞：照原本排序出，token 標 adaptive-fallback（此時 distractor source 仍存在）
        plain = [w for w in words if w.name.startswith("plain")]
        qs, _ = self._run(plain, kit, {}, count=2)
        assert [q["payload"]["tayal"]["word"] for q in qs] == ["plain0", "plain1"]
        assert {G.decode_token(q["payload"]["questionToken"]).policy for q in qs} == {"adaptive-fallback"}

    def test_questions_are_unique_words(self):
        words, kit = _world()
        qs, _ = self._run(words, kit, {}, count=4)
        names = [q["payload"]["tayal"]["word"] for q in qs]
        assert len(names) == len(set(names)) == 4

    def test_candidates_without_a_sentence_do_not_count_toward_the_cap(self):
        words, kit = _world()
        repository._word_explanations_cache[next(w.id for w in words if w.name == "mafilo")] = []
        policy = rule_selection.RulePolicy(kit, "amis", {ID["ma"]: {"p": 0.0, "n": 30, "c": 0, "v": "v"}}, random.Random(3))
        generator._generate_sentence_fill_questions(_picker_for(words), words, 4, distractor_source=D.DistractorSource(kit),
                                                    rule_policy=policy)
        assert policy.rule_counts.get(ID["ma"], 0) <= 1                  # 只有 mabelo 能出題

    def test_without_a_policy_behaviour_is_the_original_order(self):
        words, kit = _world()
        qs = generator._generate_sentence_fill_questions(_picker_for(words), words, 3, distractor_source=D.DistractorSource(kit),
                                                         token_options=generator.TokenOptions("amis", "u1"))
        assert [q["payload"]["tayal"]["word"] for q in qs] == ["mafilo", "patala", "pikuru"]
        assert {G.decode_token(q["payload"]["questionToken"]).policy for q in qs} == {"baseline"}

    def test_policy_without_token_options_still_selects(self):
        words, kit = _world()
        qs, _ = self._run(words, kit, {}, count=2, token=False)
        assert len(qs) == 2 and all("questionToken" not in q["payload"] for q in qs)


# ---------------------------------------------------------------------------
# 端點：旗標與使用者熟練度資料有傳進去
# ---------------------------------------------------------------------------

@pytest.fixture
def client():
    def _fake_db():
        yield None

    async def _fake_auth():
        return {"uid": "test-user"}

    app.dependency_overrides[get_db] = _fake_db
    app.dependency_overrides[auth_module.verify_firebase_token] = _fake_auth
    try:
        with TestClient(app, raise_server_exceptions=False) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


def _flags(**on):
    return patch.object(flags.feature_flags, "is_enabled", side_effect=lambda key, default=True: on.get(key, False))


class TestEndpoint:
    def _post(self, client, body=None):
        words = [WordDTO(id=f"w{i}", name=f"word{i}", frequency=i + 1) for i in range(40)]
        _, kit = _world()
        with patch("fastAPI.routes.quiz.api.load_all_words", return_value=words), \
             patch("fastAPI.routes.quiz.api.distractors.source_for", return_value=D.DistractorSource(kit)), \
             patch("fastAPI.routes.quiz.api._generate_sentence_fill_questions", return_value=[]) as gen:
            resp = client.post("/api/v1/quiz/generate_quiz_frontend?tribe=amis", json=body or {})
        return resp, gen

    def test_adaptive_flag_off_passes_no_policy(self, client):
        with _flags(**{flags.DIAGNOSIS: True, flags.SKILL_UPDATE: True}):
            resp, gen = self._post(client)
        assert resp.status_code == 200 and gen.call_args.kwargs["rule_policy"] is None

    def test_adaptive_flag_on_passes_a_policy_built_from_the_server_side_state(self, client):
        store = rule_state_store.MemoryStore()
        store.apply("test-user", "amis", "n1", lambda st: st.skills.update({ID["pa"]: {"p": 0.2, "n": 8, "c": 2, "v": "bkt-blend-1"}}))
        rule_state_store.set_store_for_tests(store)
        try:
            # 前端自報的 rule_skills 完全不被採用
            with _flags(**{flags.DIAGNOSIS: True, flags.SKILL_UPDATE: True, flags.ADAPTIVE: True}):
                resp, gen = self._post(client, {"rule_skills": {ID["ma"]: {"p": 0.0, "n": 99, "c": 0, "v": "x"}}})
        finally:
            rule_state_store.set_store_for_tests(None)
        policy = gen.call_args.kwargs["rule_policy"]
        assert resp.status_code == 200 and list(policy.skills) == [ID["pa"]] and policy.tribe == "amis"

    def test_no_state_store_means_no_policy(self, client):
        with _flags(**{flags.DIAGNOSIS: True, flags.SKILL_UPDATE: True, flags.ADAPTIVE: True}),              patch.object(rule_state_store, "get_store", return_value=None):
            _, gen = self._post(client)
        assert gen.call_args.kwargs["rule_policy"] is None

    def test_a_failing_state_store_means_no_policy_but_the_quiz_still_works(self, client):
        class Broken:
            def load(self, uid, tribe):
                raise rule_state_store.StoreError("down")
        rule_state_store.set_store_for_tests(Broken())
        try:
            with _flags(**{flags.DIAGNOSIS: True, flags.SKILL_UPDATE: True, flags.ADAPTIVE: True}):
                resp, gen = self._post(client)
        finally:
            rule_state_store.set_store_for_tests(None)
        assert resp.status_code == 200 and gen.call_args.kwargs["rule_policy"] is None

    def test_adaptive_flag_without_its_dependencies_is_off(self, client):
        with _flags(**{flags.ADAPTIVE: True}):
            _, gen = self._post(client)
        assert gen.call_args.kwargs["rule_policy"] is None

    def test_no_distractor_source_means_no_policy(self, client):
        words = [WordDTO(id=f"w{i}", name=f"word{i}", frequency=i + 1) for i in range(40)]
        with _flags(**{flags.DIAGNOSIS: True, flags.SKILL_UPDATE: True, flags.ADAPTIVE: True}), \
             patch("fastAPI.routes.quiz.api.load_all_words", return_value=words), \
             patch("fastAPI.routes.quiz.api.distractors.source_for", return_value=None), \
             patch("fastAPI.routes.quiz.api._generate_sentence_fill_questions", return_value=[]) as gen:
            client.post("/api/v1/quiz/generate_quiz_frontend?tribe=amis", json={})
        assert gen.call_args.kwargs["rule_policy"] is None
