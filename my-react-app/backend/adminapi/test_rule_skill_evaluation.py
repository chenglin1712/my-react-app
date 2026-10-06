"""adminapi/rule_skill_evaluation.py、evaluate_rule_skill_events 指令、模擬學習者（rule_skill_simulation.py）。

評估程式碼用手算的小例子驗證；模擬用固定種子，確認：預測器只用「作答之前」的資訊、評估流程在負對照
（只有一種整體能力）不會宣稱規則熟練度模型贏、在規則技能彼此獨立的世界裡模型確實較準。
"""
import io
import json
import random
from unittest import mock

from django.core.management import call_command
from django.test import SimpleTestCase, TestCase

from adminapi import rule_skill_evaluation as EV
from adminapi import rule_skill_simulation as SIM
from adminapi.models import QuizSkillEvent
from config import rule_skill_model as R

RULE_A = R.rule_id("amis", "P", "pa")
RULE_B = R.rule_id("amis", "P", "ma")


def _event(user, order, rule, correct, *, skill=0.6, ability=0.5, probe=True, tribe="amis"):
    return {"pseudonym": user, "order": order, "tribe": tribe, "target_rule_id": rule, "correct": correct,
            "probe": probe, "pred_skill": skill, "pred_ability": ability}


class BuildRowsTests(SimpleTestCase):
    def test_rows_are_sorted_per_user_and_exposure_counts_per_rule(self):
        events = [_event("u2", 5, RULE_A, True), _event("u1", 3, RULE_A, False), _event("u1", 1, RULE_A, True),
                  _event("u1", 2, RULE_B, True)]
        rows = EV.build_rows(events)
        self.assertEqual([(r["user"], r["exposure"]) for r in rows], [("u1", 1), ("u1", 1), ("u1", 2), ("u2", 1)])
        self.assertEqual([r["y"] for r in rows], [1, 1, 0, 1])

    def test_rule_rate_baseline_uses_only_the_users_past_answers_on_that_rule(self):
        events = [_event("u1", 1, RULE_A, True), _event("u1", 2, RULE_A, True), _event("u1", 3, RULE_A, False),
                  _event("u1", 4, RULE_B, False)]
        rows = EV.build_rows(events)
        # Beta(1,1) 平滑：第 1 次 (0+1)/(0+2)=0.5；第 2 次 (1+1)/(1+2)；第 3 次 (2+1)/(2+2)；另一條規則重新開始 0.5
        self.assertEqual([round(r["rule_rate"], 4) for r in rows], [0.5, round(2 / 3, 4), 0.75, 0.5])

    def test_prior_is_the_running_global_rate_before_each_event(self):
        events = [_event("u1", 1, RULE_A, True), _event("u2", 1, RULE_A, False)]
        rows = EV.build_rows(events)
        self.assertEqual([round(r["prior"], 4) for r in rows], [0.5, round(2 / 3, 4)])

    def test_the_baselines_never_see_the_outcome_they_predict(self):
        # 同一位使用者、同一個位置，結果翻轉後，這一筆的基線預測不能改變（前瞻預測、不洩漏）
        base = [_event("u1", 1, RULE_A, True), _event("u1", 2, RULE_A, True)]
        flipped = [_event("u1", 1, RULE_A, True), _event("u1", 2, RULE_A, False)]
        a, b = EV.build_rows(base), EV.build_rows(flipped)
        self.assertEqual((a[1]["rule_rate"], a[1]["prior"]), (b[1]["rule_rate"], b[1]["prior"]))

    def test_unusable_events_are_dropped(self):
        events = [_event("u1", 1, RULE_A, True), _event("u1", 2, RULE_A, True, probe=False),
                  _event("u1", 3, RULE_A, True, skill=None), _event("u1", 4, RULE_A, True, ability=None),
                  _event("u1", 5, "", True)]
        self.assertEqual(len(EV.build_rows(events)), 1)

    def test_empty(self):
        self.assertEqual(EV.build_rows([]), [])


def _synthetic(users=30, per_user=14, skill_is_better=True, seed=3):
    rng = random.Random(seed)
    events, order = [], 0
    for u in range(users):
        for _ in range(per_user):
            truth = rng.random()
            correct = rng.random() < truth
            sk = min(max(truth + rng.gauss(0, 0.05), 0.02), 0.98) if skill_is_better else 0.5
            ab = 0.5 if skill_is_better else min(max(truth + rng.gauss(0, 0.05), 0.02), 0.98)
            order += 1
            events.append(_event(f"u{u}", order, RULE_A if rng.random() < 0.5 else RULE_B, correct, skill=sk, ability=ab))
    return events


class EvaluateTests(SimpleTestCase):
    def test_insufficient_data_gives_descriptives_only(self):
        report = EV.evaluate(_synthetic(users=3, per_user=10), resamples=50)
        self.assertFalse(report["enough_data"])
        self.assertEqual(report["comparisons"], {})
        self.assertEqual(report["events"], 30)
        text = EV.format_report(report)
        self.assertIn("資料不足", text)
        self.assertNotIn("預測較準", text)

    def test_thresholds_are_inclusive(self):
        users = EV.MIN_USERS
        per_user = -(-EV.MIN_EVENTS // users)
        self.assertTrue(EV.evaluate(_synthetic(users=users, per_user=per_user), resamples=20)["enough_data"])
        self.assertFalse(EV.evaluate(_synthetic(users=users - 1, per_user=per_user + 5), resamples=20)["enough_data"])
        self.assertFalse(EV.evaluate(_synthetic(users=users, per_user=EV.MIN_EVENTS // users - 1), resamples=20)["enough_data"])

    def test_a_better_skill_predictor_is_reported_as_better(self):
        report = EV.evaluate(_synthetic(), resamples=200)
        self.assertTrue(report["enough_data"])
        comp = report["comparisons"]["skill_vs_ability"]
        self.assertLess(comp["log_loss"]["high"], 0)
        self.assertIn("規則熟練度的預測較準", EV.verdict(comp))

    def test_a_worse_skill_predictor_is_reported_as_worse(self):
        report = EV.evaluate(_synthetic(skill_is_better=False), resamples=200)
        comp = report["comparisons"]["skill_vs_ability"]
        self.assertGreater(comp["log_loss"]["low"], 0)
        self.assertIn("對照組的預測較準", EV.verdict(comp))

    def test_identical_predictors_show_no_difference(self):
        events = [dict(e, pred_ability=e["pred_skill"]) for e in _synthetic()]
        comp = EV.evaluate(events, resamples=100)["comparisons"]["skill_vs_ability"]
        self.assertIn("看不出", EV.verdict({"log_loss": {"low": -0.01, "high": 0.01}}))
        self.assertEqual(comp["log_loss"]["diff"], 0)

    def test_strata_are_by_exposure_and_labelled(self):
        report = EV.evaluate(_synthetic(users=10, per_user=40), resamples=20)
        labels = [s["label"] for s in report["strata"]]
        self.assertEqual(labels, ["每條規則第 1–4 次", "第 5–9 次", "第 10 次以後"])
        self.assertEqual(sum(s["skill"]["n"] for s in report["strata"]), report["events"])

    def test_calibration_bins_are_reported_for_both_predictors(self):
        report = EV.evaluate(_synthetic(), resamples=20)
        self.assertEqual(set(report["calibration"]), {"skill", "ability"})
        self.assertTrue(all(b["n"] > 0 for b in report["calibration"]["skill"]))

    def test_the_report_always_warns_that_prediction_is_not_learning_gain(self):
        for events in ([], _synthetic()):
            self.assertIn("不代表適性出題讓人學得更好", EV.format_report(EV.evaluate(events, resamples=20)))

    def test_verdict_edge_cases(self):
        self.assertIn("無法判斷", EV.verdict({"log_loss": {"low": None, "high": None}}))
        self.assertIn("無法判斷", EV.verdict({}))
        self.assertIn("看不出", EV.verdict({"log_loss": {"low": -0.2, "high": 0.0}}))      # 上界剛好 0：不算贏
        self.assertIn("看不出", EV.verdict({"log_loss": {"low": 0.0, "high": 0.2}}))
        self.assertIn("較準", EV.verdict({"log_loss": {"low": -0.2, "high": -0.001}}))


class EvaluateCommandTests(TestCase):
    def _make(self, n=6):
        for i in range(n):
            QuizSkillEvent.objects.create(
                pseudonym="p1", nonce=f"n{i}", occurred_at="2026-10-06T10:00:00Z", tribe="amis", question_type="sentence-fill",
                target_rule_id=RULE_A, diagnosis_status="correct", correct=bool(i % 2), probe=True, seconds_bucket=1,
                pred_skill=0.5, pred_ability=0.5, model_version=R.MODEL_VERSION, selection_policy="baseline", consent_version="v")
        QuizSkillEvent.objects.create(
            pseudonym="p1", nonce="np", occurred_at="2026-10-06T10:00:00Z", tribe="amis", question_type="sentence-fill",
            target_rule_id="", diagnosis_status="classified", correct=False, probe=False, seconds_bucket=1,
            model_version=R.MODEL_VERSION, selection_policy="baseline", consent_version="v")

    def test_text_report_excludes_non_probe_events(self):
        self._make()
        out = io.StringIO()
        call_command("evaluate_rule_skill_events", stdout=out)
        self.assertIn("事件 6 筆", out.getvalue())
        self.assertIn("資料不足", out.getvalue())

    def test_json_output_and_tribe_filter(self):
        self._make()
        out = io.StringIO()
        call_command("evaluate_rule_skill_events", "--json", "--tribe", "amis", stdout=out)
        self.assertEqual(json.loads(out.getvalue())["events"], 6)
        out = io.StringIO()
        call_command("evaluate_rule_skill_events", "--json", "--tribe", "tayal", stdout=out)
        self.assertEqual(json.loads(out.getvalue())["events"], 0)

    def test_command_is_read_only(self):
        self._make()
        before = QuizSkillEvent.objects.count()
        call_command("evaluate_rule_skill_events", stdout=io.StringIO())
        self.assertEqual(QuizSkillEvent.objects.count(), before)

    def test_empty_database(self):
        out = io.StringIO()
        call_command("evaluate_rule_skill_events", stdout=out)
        self.assertIn("事件 0 筆", out.getvalue())


class PredictorPurityTests(SimpleTestCase):
    def test_ability_predict_does_not_mutate_state(self):
        predictor = SIM.AbilityPredictor()
        predictor.update("w1", True)
        before = (predictor.theta, dict(predictor.word), list(predictor.qtype))
        first = predictor.predict("w1")
        self.assertEqual(first, predictor.predict("w1"))
        self.assertEqual(before, (predictor.theta, dict(predictor.word), list(predictor.qtype)))

    def test_ability_update_moves_theta_the_right_way(self):
        up, down = SIM.AbilityPredictor(), SIM.AbilityPredictor()
        up.update("w", True)
        down.update("w", False)
        self.assertGreater(up.theta, 0.5)
        self.assertLess(down.theta, 0.5)
        self.assertGreater(up.predict("w2"), down.predict("w2"))

    def test_the_prediction_for_an_event_does_not_depend_on_its_own_outcome(self):
        # 反事實：兩個世界在某一題之前完全相同、只有那一題的結果被翻轉。那一題記下的預測必須一樣
        # （預測在作答前算好），但之後的預測要有變化（否則這個測試沒有意義）。
        scenario = SIM.with_overrides(SIM.SCENARIOS["baseline"], learners=1, questions=40, probe_rate=1.0)
        base = SIM.run(scenario)["events"]
        k = 12
        flipped = SIM.run(scenario, outcomes={(0, k): not base[k]["correct"]})["events"]
        self.assertEqual(len(base), len(flipped))
        for i in range(k + 1):
            self.assertEqual((base[i]["pred_skill"], base[i]["pred_ability"]), (flipped[i]["pred_skill"], flipped[i]["pred_ability"]))
        self.assertNotEqual(base[k]["correct"], flipped[k]["correct"])
        self.assertTrue(any((base[i]["pred_skill"], base[i]["pred_ability"]) != (flipped[i]["pred_skill"], flipped[i]["pred_ability"])
                            for i in range(k + 1, len(base))))


class RecoveryMetricTests(SimpleTestCase):
    def _estimated(self, ps):
        ids = [R.rule_id("amis", "P", f"r{i}") for i in range(len(ps))]
        return {rid: {"p": p, "n": 9, "c": 4, "v": "v"} for rid, p in zip(ids, ps)}, ids

    def test_perfect_and_reversed_ordering(self):
        est, ids = self._estimated([0.1, 0.3, 0.5, 0.7, 0.9])
        rho, recall = SIM._recovery(est, ids, [0.0, 1.0, 2.0, 3.0, 4.0])
        self.assertAlmostEqual(rho, 1.0)
        self.assertEqual(recall, 1.0)
        rho, recall = SIM._recovery(est, ids, [4.0, 3.0, 2.0, 1.0, 0.0])
        self.assertAlmostEqual(rho, -1.0)
        self.assertEqual(recall, 0.0)

    def test_too_few_rules_with_enough_data_is_not_scored(self):
        est, ids = self._estimated([0.1, 0.5, 0.9])
        self.assertEqual(SIM._recovery(est, ids, [0, 1, 2]), (None, None))

    def test_rules_without_enough_data_are_ignored(self):
        est, ids = self._estimated([0.1, 0.3, 0.5, 0.7, 0.9])
        est[ids[0]]["n"] = 1                       # 這條規則資料不夠，不納入（剩 4 條仍可計算）
        rho, recall = SIM._recovery(est, ids, [99, 1, 2, 3, 4])          # 被忽略的那條真實技能是離群值，也不該影響結果
        self.assertAlmostEqual(rho, 1.0)
        self.assertEqual(recall, 1.0)

    def test_ranks_handle_ties(self):
        self.assertEqual(SIM._ranks([1, 2, 2, 3]), [1.0, 2.5, 2.5, 4.0])


class SimulationScenarioTests(SimpleTestCase):
    def _scenario(self, name, **kw):
        return SIM.with_overrides(SIM.SCENARIOS[name], learners=60, **kw)

    def test_runs_are_reproducible_for_a_seed(self):
        s = SIM.with_overrides(SIM.SCENARIOS["baseline"], learners=5, questions=30)
        self.assertEqual(SIM.run(s)["events"], SIM.run(s)["events"])
        self.assertNotEqual(SIM.run(s)["events"], SIM.run(SIM.with_overrides(s, seed=8))["events"])

    def test_events_have_the_fields_the_evaluator_needs_and_are_probe_only(self):
        events = SIM.run(SIM.with_overrides(SIM.SCENARIOS["baseline"], learners=3, questions=40))["events"]
        self.assertTrue(events)
        for e in events:
            self.assertTrue(e["probe"] and 0 < e["pred_skill"] < 1 and 0 < e["pred_ability"] < 1 and 0 < e["pred_oracle"] < 1)
            self.assertIsNotNone(R.parse_rule_id(e["target_rule_id"]))

    def test_oracle_is_the_best_predictor(self):
        report = SIM.evaluate_scenario(self._scenario("baseline"), resamples=20)
        for name in ("skill", "ability", "rule_rate", "prior"):
            self.assertLess(report["oracle"]["log_loss"], report["overall"][name]["log_loss"])

    def test_negative_control_never_shows_the_rule_model_winning(self):
        # 只有一種整體能力：規則熟練度模型不該贏。贏了就代表評估流程有洩漏答案之類的問題。
        report = SIM.evaluate_scenario(self._scenario("one_skill_control"), resamples=200)
        ll = report["comparisons"]["skill_vs_ability"]["log_loss"]
        self.assertGreaterEqual(ll["high"], 0)
        self.assertLess(abs(ll["diff"]), 0.03)          # 差距也要很小，不只是「不顯著」

    def test_the_rule_model_wins_when_rule_skills_really_differ(self):
        report = SIM.evaluate_scenario(self._scenario("independent_skills"), resamples=200)
        ll = report["comparisons"]["skill_vs_ability"]["log_loss"]
        self.assertLess(ll["high"], 0)

    def test_weak_rules_are_recovered_better_than_chance_when_skills_differ(self):
        rec = SIM.run(self._scenario("independent_skills"))["recovery"]
        self.assertGreater(rec["mean_weakest_recall"], rec["chance_weakest_recall"] + 0.15)
        self.assertGreater(rec["mean_spearman"], 0.3)

    def test_misattribution_does_not_break_the_pipeline(self):
        report = SIM.evaluate_scenario(SIM.with_overrides(self._scenario("misattributed"), learners=20), resamples=20)
        self.assertGreater(report["events"], 300)

    def test_format_includes_the_oracle_and_the_verdict(self):
        text = SIM.format_scenario(SIM.evaluate_scenario(SIM.with_overrides(SIM.SCENARIOS["baseline"], learners=40), resamples=30))
        self.assertIn("oracle", text)
        self.assertIn("規則熟練度 vs 單一能力值", text)


class SimulationCommandTests(SimpleTestCase):
    def test_runs_selected_scenarios_and_warns(self):
        out = io.StringIO()
        call_command("simulate_rule_skill_learners", "--scenario", "one_skill_control", "--learners", "20", "--resamples", "20", stdout=out)
        text = out.getvalue()
        self.assertIn("one_skill_control", text)
        self.assertNotIn("[baseline]", text)
        self.assertIn("不是對真人有效的證據", text)

    def test_overrides_are_applied(self):
        with mock.patch.object(SIM, "evaluate_scenario", wraps=SIM.evaluate_scenario) as spy:
            call_command("simulate_rule_skill_learners", "--scenario", "sparse", "--learners", "7", "--seed", "3",
                         "--resamples", "10", stdout=io.StringIO())
        used = spy.call_args.args[0]
        self.assertEqual((used.learners, used.seed), (7, 3))
