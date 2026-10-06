"""詞素診斷接進出題與作答端點的整合行為（answer_flow.py、generator 的 token、api.py）。

要鎖住的行為：
- 四個旗標預設全關，且有相依關係；任何旗標查詢失敗視為關閉；
- 旗標關閉時，出題與作答的回應跟以前一樣（沒有 token、診斷為 None、沒有任何狀態被寫入）；
- 規則熟練度由【伺服器】持有：token 驗證通過（綁定使用者、題目、族語、目標詞）、這題真的在測那條規則，
  才更新；同一題的 token 重送只會更新一次；前端自報的 correct 與 token 矛盾時以伺服器判斷的為準；
- 選到別的詞根、token 不合、歧義都不更新；
- 診斷與更新過程任何地方出錯，都不能影響既有的 IRT 更新與回應。
"""
import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from config import rule_skill_model as R
from config.tribes import TRIBES
from dictionary_db.connect import get_db
from fastAPI.main import app
from fastAPI.routes import auth as auth_module
from fastAPI.routes.quiz import answer_flow, flags, generator, repository, rule_state_store
from fastAPI.routes.quiz import diagnosis as G
from fastAPI.routes.quiz import distractors as D
from fastAPI.routes.quiz.schemas import WordDTO
from fastAPI.tests.test_quiz_diagnosis import SECRET, UID, _kit
from fastAPI.tests.test_quiz_diagnosis import _context as _context_at


def _context(**kwargs):
    """端點與流程用真實時間簽發 token（token 驗證會檢查發行與到期時間）。"""
    return _context_at(now=None, **kwargs)

TRIBE = next(t for t in TRIBES if t.slug == "amis")
TAYAL = next(t for t in TRIBES if t.slug == "tayal")
MA_ID = R.rule_id("amis", "P", "ma")


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv(G.SECRET_ENV, SECRET)
    monkeypatch.delenv(G.PREVIOUS_SECRET_ENV, raising=False)


@pytest.fixture
def store():
    memory = rule_state_store.MemoryStore()
    rule_state_store.set_store_for_tests(memory)
    yield memory
    rule_state_store.set_store_for_tests(None)


def _flags(**on):
    """patch feature_flags.is_enabled：只有指定的旗標是開的。"""
    def fake(key, default=True):
        return on.get(key, False)
    return patch.object(flags.feature_flags, "is_enabled", side_effect=fake)


ALL_ON = {flags.DIAGNOSIS: True, flags.SKILL_UPDATE: True, flags.ADAPTIVE: True, flags.EVENTS: True}


class TestFlags:
    def test_all_off_by_default_when_unknown(self):
        with patch.object(flags.feature_flags, "is_enabled", side_effect=lambda key, default=True: default):
            assert not any(flags.enabled(k) for k in flags.ALL_FLAGS)

    def test_dependencies(self):
        with _flags(**{flags.SKILL_UPDATE: True}):
            assert not flags.enabled(flags.SKILL_UPDATE)          # 缺診斷
        with _flags(**{flags.DIAGNOSIS: True, flags.SKILL_UPDATE: True}):
            assert flags.enabled(flags.SKILL_UPDATE) and not flags.enabled(flags.ADAPTIVE)
        with _flags(**{flags.DIAGNOSIS: True, flags.ADAPTIVE: True}):
            assert not flags.enabled(flags.ADAPTIVE)              # 缺熟練度更新
        with _flags(**{flags.DIAGNOSIS: True, flags.SKILL_UPDATE: True, flags.ADAPTIVE: True}):
            assert flags.enabled(flags.ADAPTIVE)
        with _flags(**{flags.EVENTS: True}):
            assert not flags.enabled(flags.EVENTS)                # 缺診斷
        with _flags(**{flags.DIAGNOSIS: True, flags.EVENTS: True}):
            assert flags.enabled(flags.EVENTS)

    def test_lookup_failure_is_off(self):
        with patch.object(flags.feature_flags, "is_enabled", side_effect=RuntimeError("db")):
            assert flags.enabled(flags.DIAGNOSIS) is False

    def test_unknown_flag_is_a_programming_error(self):
        with pytest.raises(KeyError):
            flags.enabled("nope")

    def test_default_lookup_is_off(self):
        calls = []
        with patch.object(flags.feature_flags, "is_enabled", side_effect=lambda key, default=True: calls.append(default) or False):
            flags.enabled(flags.DIAGNOSIS)
        assert calls == [False]


def _answer(ctx, selected, *, token="auto", qtype="sentence-fill", time_spent=3.0):
    return {"question_id": ctx.question_id, "question_type": qtype, "word_name": ctx.target,
            "correct": selected == ctx.target, "time_spent": time_spent, "selected_option": selected,
            "question_token": G.encode_token(ctx) if token == "auto" else token}


class TestPrepare:
    def test_valid_token_gives_a_high_confidence_diagnosis(self):
        _, _, ctx = _context()
        with _flags(**ALL_ON):
            diag = answer_flow.prepare(None, TRIBE, _answer(ctx, "mafilo"), UID)
        assert (diag.status, diag.confidence, diag.probe, diag.nonce) == ("correct", "high", True, ctx.nonce)

    def test_flag_off_returns_none(self):
        _, _, ctx = _context()
        with _flags():
            assert answer_flow.prepare(None, TRIBE, _answer(ctx, "mafilo"), UID) is None

    @pytest.mark.parametrize("qtype,selected", [("word-translate", "mafilo"), ("sentence-order", "mafilo"), ("sentence-fill", None), ("sentence-fill", "")])
    def test_other_question_types_and_missing_selection_are_ignored(self, qtype, selected):
        _, _, ctx = _context()
        answer = _answer(ctx, "mafilo", qtype=qtype)
        answer["selected_option"] = selected
        with _flags(**ALL_ON):
            assert answer_flow.prepare(None, TRIBE, answer, UID) is None

    def test_invalid_token_falls_back_to_recompute(self):
        _, _, ctx = _context()
        kit = _kit(lexicon={"mafilo", "filo"}, derived={"mafilo": ("filo",)})
        with _flags(**ALL_ON), patch.object(D, "get_kit", return_value=kit):
            diag = answer_flow.prepare(None, TRIBE, _answer(ctx, "pafilo", token="garbage"), UID)
        assert diag.confidence == "medium" and diag.error_type == "wrong_affix" and diag.reason.startswith("token_invalid:")

    def test_missing_token_has_no_token_invalid_marker(self):
        _, _, ctx = _context()
        kit = _kit(lexicon={"mafilo", "filo"}, derived={"mafilo": ("filo",)})
        with _flags(**ALL_ON), patch.object(D, "get_kit", return_value=kit):
            diag = answer_flow.prepare(None, TRIBE, _answer(ctx, "pafilo", token=None), UID)
        assert diag.reason == "recomputed"

    @pytest.mark.parametrize("who", ["someone-else", ""])
    def test_token_of_another_user_is_rejected(self, who):
        _, _, ctx = _context()
        with _flags(**ALL_ON), patch.object(D, "get_kit", return_value=None):
            diag = answer_flow.prepare(None, TRIBE, _answer(ctx, "mafilo"), who)
        assert diag.confidence == "medium"

    def test_token_for_another_question_or_tribe_is_rejected(self):
        _, _, ctx = _context()
        answer = _answer(ctx, "mafilo")
        answer["question_id"] = "sf-other-9"
        with _flags(**ALL_ON), patch.object(D, "get_kit", return_value=None):
            assert answer_flow.prepare(None, TRIBE, answer, UID).confidence == "medium"
            assert answer_flow.prepare(None, TAYAL, _answer(ctx, "mafilo"), UID).confidence == "medium"

    def test_kit_lookup_failure_is_survivable(self):
        _, _, ctx = _context()
        with _flags(**ALL_ON), patch.object(D, "get_kit", side_effect=RuntimeError("db")):
            diag = answer_flow.prepare(None, TRIBE, _answer(ctx, "x", token=None), UID)
        assert diag.reason == "no_kit"

    def test_unexpected_error_returns_none(self):
        _, _, ctx = _context()
        with _flags(**ALL_ON), patch.object(G, "diagnose_with_context", side_effect=RuntimeError("boom")):
            assert answer_flow.prepare(None, TRIBE, _answer(ctx, "mafilo"), UID) is None

    def test_flag_lookup_error_returns_none(self):
        _, _, ctx = _context()
        with patch.object(flags.feature_flags, "is_enabled", side_effect=RuntimeError("db")):
            assert answer_flow.prepare(None, TRIBE, _answer(ctx, "mafilo"), UID) is None


def _diag(status, *, confidence="high", error=None, probe=True, selected_rule=None, target_rule=MA_ID, nonce="n1",
          expires_at=None):
    return G.Diagnosis(status, error, target_rule, selected_rule, confidence, "x", probe=probe,
                       kit_version="kv1", policy="baseline", nonce=nonce,
                       expires_at=int(time.time()) + 7200 if expires_at is None else expires_at)


class TestAuthoritativeCorrect:
    def test_none_diagnosis_keeps_the_client_value(self):
        assert answer_flow.authoritative_correct(None, True) is True and answer_flow.authoritative_correct(None, False) is False

    def test_medium_confidence_keeps_the_client_value(self):
        assert answer_flow.authoritative_correct(_diag("correct", confidence="medium"), False) is False

    def test_invalid_option_keeps_the_client_value(self):
        assert answer_flow.authoritative_correct(_diag("invalid_option"), True) is True

    def test_server_overrides_a_lying_client(self):
        with patch.object(answer_flow, "logger") as log:
            assert answer_flow.authoritative_correct(_diag("correct"), False) is True
            assert answer_flow.authoritative_correct(_diag("classified", error="wrong_affix"), True) is False
        assert log.warning.call_count == 2 and "mismatch" in log.warning.call_args.args[0]

    @pytest.mark.parametrize("status", ["classified", "ambiguous", "unclassified"])
    def test_any_valid_non_target_choice_is_wrong(self, status):
        assert answer_flow.authoritative_correct(_diag(status), True) is False

    def test_agreement_logs_nothing(self):
        with patch.object(answer_flow, "logger") as log:
            assert answer_flow.authoritative_correct(_diag("correct"), True) is True
        assert not log.warning.called


class TestUpdateSkills:
    def test_correct_probe_updates_the_target_rule(self, store):
        with _flags(**ALL_ON):
            update = answer_flow.update_skills(_diag("correct"), "amis", UID)
        assert update["rule"] == MA_ID and update["before"] == R.P_INIT and update["after"] > R.P_INIT and update["n"] == 1
        assert update["answered"] == 1 and update["pred_skill"] == R.overall_rate(None)        # 沒資料時預測就是整體先驗 0.5
        state = store.load(UID, "amis")
        assert state.skills[MA_ID]["c"] == 1 and state.revision == 1 and state.confusions == {}
        assert state.overall == {"n": 1, "c": 1}

    def test_wrong_affix_lowers_estimate_and_records_the_confusion(self, store):
        pa = R.rule_id("amis", "P", "pa")
        with _flags(**ALL_ON):
            answer_flow.update_skills(_diag("correct", nonce="n0"), "amis", UID)
            update = answer_flow.update_skills(_diag("classified", error="wrong_affix", selected_rule=pa, nonce="n1"), "amis", UID)
        assert update["after"] < update["before"] + R.P_LEARN
        state = store.load(UID, "amis")
        assert state.skills[MA_ID]["n"] == 2 and state.skills[MA_ID]["c"] == 1
        assert state.confusions == {f"{MA_ID}>{pa}": 1}

    def test_wrong_root_and_non_probe_answers_count_toward_overall_but_never_touch_a_rule(self, store):
        with _flags(**ALL_ON):
            first = answer_flow.update_skills(_diag("classified", error="wrong_root", nonce="a"), "amis", UID)
            second = answer_flow.update_skills(_diag("correct", probe=False, nonce="b"), "amis", UID)
        assert first == {"answered": 1} and second == {"answered": 2}              # 沒有 rule / pred_skill
        state = store.load(UID, "amis")
        assert state.skills == {} and state.confusions == {} and state.overall == {"n": 2, "c": 1}

    def test_unverified_or_invalid_answers_never_touch_the_state(self, store):
        with _flags(**ALL_ON):
            assert answer_flow.update_skills(_diag("correct", confidence="medium"), "amis", UID) is None
            assert answer_flow.update_skills(_diag("invalid_option"), "amis", UID) is None
            assert answer_flow.update_skills(_diag("correct", nonce=""), "amis", UID) is None
            assert answer_flow.update_skills(_diag("correct", expires_at=0), "amis", UID) is None     # 沒有 token 到期時間
            assert answer_flow.update_skills(None, "amis", UID) is None
        assert store.load(UID, "amis") == rule_state_store.RuleState()

    def test_ambiguous_and_unclassified_answers_count_as_wrong_overall(self, store):
        with _flags(**ALL_ON):
            answer_flow.update_skills(_diag("ambiguous", nonce="a"), "amis", UID)
            answer_flow.update_skills(_diag("unclassified", nonce="b"), "amis", UID)
        assert store.load(UID, "amis").overall == {"n": 2, "c": 0} and store.load(UID, "amis").skills == {}

    def test_an_answer_without_a_nonce_never_reaches_the_store(self, store):
        with _flags(**ALL_ON), patch.object(store, "apply") as apply:
            assert answer_flow.update_skills(_diag("correct", nonce=""), "amis", UID) is None
        apply.assert_not_called()

    def test_the_prediction_uses_the_state_before_this_answer(self, store):
        with _flags(**ALL_ON):
            for i in range(3):                                 # 先答對 3 題，整體表現與規則熟練度都改變
                answer_flow.update_skills(_diag("correct", nonce=f"n{i}"), "amis", UID)
            state = store.load(UID, "amis")
            expected = R.blended_prediction(state.skills, MA_ID, state.overall)
            update = answer_flow.update_skills(_diag("correct", nonce="n3"), "amis", UID)
        assert update["pred_skill"] == expected and update["pred_skill"] > R.overall_rate(None)
        assert store.load(UID, "amis").skills[MA_ID]["n"] == 4

    def test_skill_flag_off_never_updates(self, store):
        with _flags(**{flags.DIAGNOSIS: True}):
            assert answer_flow.update_skills(_diag("correct"), "amis", UID) is None
        assert store.load(UID, "amis").skills == {}

    def test_no_store_means_no_update(self):
        rule_state_store.set_store_for_tests(None)
        with _flags(**ALL_ON), patch.object(rule_state_store, "get_store", return_value=None):
            assert answer_flow.update_skills(_diag("correct"), "amis", UID) is None

    def test_same_nonce_is_applied_only_once(self, store):
        with _flags(**ALL_ON):
            first = answer_flow.update_skills(_diag("correct", nonce="same"), "amis", UID)
            second = answer_flow.update_skills(_diag("correct", nonce="same"), "amis", UID)
        assert first["n"] == 1 and second == {"duplicate": True}
        assert store.load(UID, "amis").skills[MA_ID]["n"] == 1 and store.load(UID, "amis").revision == 1
        assert store.load(UID, "amis").overall == {"n": 1, "c": 1}

    def test_users_and_tribes_are_isolated(self, store):
        with _flags(**ALL_ON):
            answer_flow.update_skills(_diag("correct", nonce="a"), "amis", "alice")
            answer_flow.update_skills(_diag("correct", nonce="b"), "amis", "bob")
            answer_flow.update_skills(_diag("correct", nonce="c"), "tayal", "alice")
        assert store.load("alice", "amis").skills[MA_ID]["n"] == 1 and store.load("bob", "amis").skills[MA_ID]["n"] == 1
        assert store.load("alice", "tayal").skills[MA_ID]["n"] == 1
        assert store.load("alice", "bunun").skills == {}

    def test_the_same_nonce_for_different_users_is_independent(self, store):
        with _flags(**ALL_ON):
            assert answer_flow.update_skills(_diag("correct", nonce="n"), "amis", "alice")["n"] == 1
            assert answer_flow.update_skills(_diag("correct", nonce="n"), "amis", "bob")["n"] == 1

    def test_store_errors_are_reported_as_unavailable_not_raised(self, store):
        with _flags(**ALL_ON), patch.object(store, "apply", side_effect=rule_state_store.StoreError("down")):
            assert answer_flow.update_skills(_diag("correct"), "amis", UID) == {"unavailable": "error"}

    def test_a_full_nonce_store_refuses_updates_instead_of_forgetting_old_nonces(self, store):
        far = int(time.time()) + 7200
        for i in range(rule_state_store.MAX_NONCES):
            store.apply(UID, "amis", f"f{i}", lambda st: None, far + i)
        with _flags(**ALL_ON):
            assert answer_flow.update_skills(_diag("correct", nonce="new"), "amis", UID) == {"unavailable": "error"}
        assert store.load(UID, "amis").skills == {}

    def test_invalid_uid_is_reported_as_unavailable(self, store):
        with _flags(**ALL_ON):
            assert answer_flow.update_skills(_diag("correct"), "amis", "a/b") == {"unavailable": "error"}
            assert answer_flow.update_skills(_diag("correct"), "amis", "") == {"unavailable": "error"}

    def test_a_slow_store_gives_up_after_the_deadline_and_says_so(self, store):
        import threading
        release = threading.Event()

        def slow_apply(*args, **kwargs):
            release.wait(5)
            return True, {}
        with _flags(**ALL_ON), patch.object(store, "apply", side_effect=slow_apply), \
             patch.object(answer_flow, "MODEL_UPDATE_TIMEOUT", 0.05):
            started = time.monotonic()
            result = answer_flow.update_skills(_diag("correct"), "amis", UID)
            elapsed = time.monotonic() - started
        release.set()
        assert result == {"unavailable": "timeout"} and elapsed < 1.0

    def test_when_every_worker_is_busy_the_update_is_skipped_immediately(self, store):
        import threading
        from fastAPI.routes.quiz import deadline
        exhausted = threading.BoundedSemaphore(1)
        exhausted.acquire()
        with _flags(**ALL_ON), patch.object(deadline, "_slots", exhausted), patch.object(store, "apply") as apply:
            assert answer_flow.update_skills(_diag("correct"), "amis", UID) == {"unavailable": "busy"}
        apply.assert_not_called()

    def test_the_token_expiry_is_what_the_store_keeps_the_nonce_until(self, store):
        with _flags(**ALL_ON), patch.object(store, "apply", wraps=store.apply) as apply:
            answer_flow.update_skills(_diag("correct", expires_at=int(time.time()) + 1234), "amis", UID)
        assert apply.call_args.args[4] > time.time()
        assert list(store.load(UID, "amis").nonces.values())[0] == apply.call_args.args[4]

    def test_flag_lookup_error_is_swallowed(self, store):
        with patch.object(flags.feature_flags, "is_enabled", side_effect=RuntimeError("db")):
            assert answer_flow.update_skills(_diag("correct"), "amis", UID) is None

    def test_repeated_answers_accumulate(self, store):
        with _flags(**ALL_ON):
            for i in range(6):
                answer_flow.update_skills(_diag("correct", nonce=f"n{i}"), "amis", UID)
        skill = store.load(UID, "amis").skills[MA_ID]
        assert skill["n"] == 6 and skill["c"] == 6 and skill["p"] > 0.8 and R.has_enough_data(skill)


class TestRecordEvent:
    def _record(self, diag, *, rule_update=None, flags_on=None, answer=None, **kw):
        with _flags(**(ALL_ON if flags_on is None else flags_on)), patch.object(answer_flow.research_events, "record_skill_event", return_value=True) as rec:
            ok = answer_flow.record_event(diag, "amis", UID, answer or {"time_spent": 7.5}, pred_ability=0.61234567,
                                          ability_before=0.5, rule_update=rule_update, **kw)
        return ok, rec

    def test_builds_a_minimal_event(self):
        update = {"rule": MA_ID, "before": 0.35, "after": 0.6, "n": 1, "pred_skill": 0.4123456, "answered": 4}
        ok, rec = self._record(_diag("correct"), rule_update=update)
        assert ok is True
        uid, event = rec.call_args.args
        assert uid == UID
        assert event == {
            "nonce": "n1", "tribe": "amis", "question_type": "sentence-fill", "target_rule_id": MA_ID,
            "selected_rule_id": "", "diagnosis_status": "correct", "error_type": "", "correct": True, "probe": True,
            "seconds_bucket": 2, "p_before": 0.35, "p_after": 0.6,
            "pred_skill": 0.4123, "pred_ability": 0.6123, "ability_before": 0.5,
            "model_version": R.MODEL_VERSION, "kit_version": "kv1", "selection_policy": "baseline",
        }

    def test_event_has_exactly_the_columns_the_table_requires(self):
        from fastAPI.routes.quiz import research_events as E
        _, rec = self._record(_diag("correct"), rule_update={"rule": MA_ID, "before": 0.35, "after": 0.6, "n": 1, "pred_skill": 0.4})
        keys = set(rec.call_args.args[1])
        assert E.REQUIRED_EVENT_COLUMNS <= keys <= E.EVENT_COLUMNS

    def test_wrong_answers_carry_the_selected_rule_and_error_type(self):
        pa = R.rule_id("amis", "P", "pa")
        _, rec = self._record(_diag("classified", error="wrong_affix", selected_rule=pa),
                              rule_update={"before": 0.4, "after": 0.3, "n": 3, "pred_skill": 0.45})
        event = rec.call_args.args[1]
        assert event["correct"] is False and event["error_type"] == "wrong_affix" and event["selected_rule_id"] == pa

    def test_no_rule_prediction_when_the_question_did_not_test_a_rule(self):
        _, rec = self._record(_diag("classified", error="wrong_root", probe=True), rule_update={"answered": 3})
        event = rec.call_args.args[1]
        assert event["pred_skill"] is None and event["p_before"] is None and event["p_after"] is None
        assert event["pred_ability"] == 0.6123

    def test_no_event_for_duplicates_invalid_medium_or_missing(self):
        for diag, update in ((_diag("correct"), {"duplicate": True}), (_diag("correct"), {"unavailable": "timeout"}),
                             (_diag("invalid_option"), None),
                             (_diag("correct", confidence="medium"), None), (None, None), (_diag("correct", nonce=""), None)):
            ok, rec = self._record(diag, rule_update=update)
            assert ok is False and not rec.called

    def test_flag_off_or_missing_dependency_records_nothing(self):
        for on in ({}, {flags.EVENTS: True}, {flags.DIAGNOSIS: True}):
            ok, rec = self._record(_diag("correct"), flags_on=on)
            assert ok is False and not rec.called

    def test_failures_are_swallowed(self):
        with _flags(**ALL_ON), patch.object(answer_flow.research_events, "record_skill_event", side_effect=RuntimeError("x")):
            assert answer_flow.record_event(_diag("correct"), "amis", UID, {}, pred_ability=0.5, ability_before=0.5, rule_update=None) is False

    def test_seconds_are_bucketed_not_stored_raw(self):
        _, rec = self._record(_diag("correct"), answer={"time_spent": 123.4})
        assert rec.call_args.args[1]["seconds_bucket"] == 5


# ---------------------------------------------------------------------------
# 出題：token 只在該附的時候附
# ---------------------------------------------------------------------------

def _fill_setup():
    words = [WordDTO(id=f"w{i}", name=f"word{i}", frequency=1) for i in range(12)]
    words[0] = WordDTO(id="w0", name="mafilo", frequency=1)
    repository._word_explanations_cache.clear()
    repository._word_audios_cache.clear()
    for w in words:
        repository._word_audios_cache[w.id] = [{"fileId": f"audio-{w.id}"}]
    repository._word_explanations_cache["w0"] = [{"chineseExplanation": "示範", "sentenceItems": [
        {"originalSentence": "Ini mafilo kako.", "chineseSentence": "中文", "audioItems": [{"fileId": "s"}]}]}]
    kit = _kit(lexicon={"mafilo", "filo"} | {w.name for w in words}, derived={"mafilo": ("filo",)})
    return words, D.DistractorSource(kit)


class TestGeneratorToken:
    def _generate(self, words, source, token_options):
        picker = generator._CandidatePicker([{"word": words[0]}])
        return generator._generate_sentence_fill_questions(picker, words, 1, distractor_source=source, token_options=token_options)

    def test_token_describes_exactly_the_options_shown_and_is_bound_to_the_user(self):
        words, source = _fill_setup()
        q = self._generate(words, source, generator.TokenOptions("amis", UID, "adaptive-explore"))[0]
        ctx = G.verify_for_answer(q["payload"]["questionToken"], question_id=q["id"], tribe="amis", word_name="mafilo", uid=UID)
        assert ctx is not None and ctx.policy == "adaptive-explore"
        assert G.verify_for_answer(q["payload"]["questionToken"], question_id=q["id"], tribe="amis", word_name="mafilo", uid="other") is None
        shown = [o["word"] for o in q["payload"]["options"]]
        assert sorted(o.word for o in ctx.options) == sorted(shown)
        engine_words = set(q["payload"]["distractorNotes"])
        assert {o.word for o in ctx.options if o.role == G.ROLE_ENGINE} == engine_words
        assert {o.word for o in ctx.options if o.role == G.ROLE_TARGET} == {"mafilo"}
        assert ctx.probe is True and ctx.target_rule_id == MA_ID and ctx.kit_version == "kv1"

    def test_the_payload_does_not_expose_the_token_content(self):
        words, source = _fill_setup()
        q = self._generate(words, source, generator.TokenOptions("amis", UID, "adaptive-explore"))[0]
        assert "adaptive" not in q["payload"]["questionToken"] and "engine" not in q["payload"]["questionToken"]

    def test_no_token_options_means_no_token(self):
        words, source = _fill_setup()
        assert "questionToken" not in self._generate(words, source, None)[0]["payload"]

    def test_no_secret_means_no_token_but_the_question_is_fine(self, monkeypatch):
        monkeypatch.delenv(G.SECRET_ENV)
        words, source = _fill_setup()
        q = self._generate(words, source, generator.TokenOptions("amis", UID))[0]
        assert "questionToken" not in q["payload"] and q["type"] == "sentence-fill" and q["payload"]["options"]

    def test_no_distractor_source_means_no_token(self):
        words, _ = _fill_setup()
        assert "questionToken" not in self._generate(words, None, generator.TokenOptions("amis", UID))[0]["payload"]

    def test_token_failure_never_breaks_question_generation(self):
        words, source = _fill_setup()
        with patch.object(G, "build_context", side_effect=RuntimeError("boom")):
            q = self._generate(words, source, generator.TokenOptions("amis", UID))[0]
        assert q["type"] == "sentence-fill" and "questionToken" not in q["payload"]

    def test_token_ids_match_question_ids(self):
        words, source = _fill_setup()
        q = self._generate(words, source, generator.TokenOptions("amis", UID))[0]
        assert G.decode_token(q["payload"]["questionToken"]).question_id == q["id"]

    def test_build_user_model_no_longer_carries_rule_state(self):
        assert "rule_skills" not in generator._build_user_model({"rule_skills": {"a": 1}})


# ---------------------------------------------------------------------------
# 端點
# ---------------------------------------------------------------------------

def _make_client(uid):
    def _fake_db():
        yield None

    async def _fake_auth():
        return {"uid": uid}

    app.dependency_overrides[get_db] = _fake_db
    app.dependency_overrides[auth_module.verify_firebase_token] = _fake_auth
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def client():
    c = _make_client(UID)
    try:
        with c:
            yield c
    finally:
        app.dependency_overrides.clear()


def _submit(client, ctx, selected, user_data=None, **answer_overrides):
    answer = {"question_id": ctx.question_id, "question_type": "sentence-fill", "word_name": ctx.target,
              "correct": selected == ctx.target, "time_spent": 4.0, "selected_option": selected,
              "question_token": G.encode_token(ctx)}
    answer.update(answer_overrides)
    words = [WordDTO(id=f"w{i}", name=f"word{i}", frequency=1) for i in range(5)]
    with patch("fastAPI.routes.quiz.api.load_all_words", return_value=words):
        return client.post("/api/v1/quiz/submit_answer_frontend?tribe=amis",
                           json={"user_data": user_data or {}, "answer": answer})


class TestSubmitEndpoint:
    def test_flags_off_response_is_unchanged_and_nothing_is_stored(self, client, store):
        _, _, ctx = _context()
        with _flags():
            body = _submit(client, ctx, "mafilo").json()
        assert body["diagnosis"] is None and body["rule_update"] is None and "new_theta" in body
        assert store.load(UID, "amis") == rule_state_store.RuleState()

    def test_flags_on_diagnoses_and_updates_the_server_side_state(self, client, store):
        _, _, ctx = _context()
        with _flags(**ALL_ON):
            body = _submit(client, ctx, "mafilo").json()
        assert body["diagnosis"]["status"] == "correct" and body["rule_update"]["rule"] == MA_ID
        assert store.load(UID, "amis").skills[MA_ID]["n"] == 1
        assert "rule_skills" not in body["user_model"]            # 規則狀態不經前端

    def test_resubmitting_the_same_token_updates_only_once(self, client, store):
        _, _, ctx = _context()
        with _flags(**ALL_ON):
            first = _submit(client, ctx, "mafilo").json()
            second = _submit(client, ctx, "mafilo").json()
        assert first["rule_update"]["n"] == 1 and second["rule_update"] == {"duplicate": True}
        assert store.load(UID, "amis").skills[MA_ID]["n"] == 1

    def test_state_accumulates_across_questions_without_the_client_carrying_it(self, client, store):
        with _flags(**ALL_ON):
            _, _, ctx = _context()
            _submit(client, ctx, "mafilo")
            _, engine, ctx2 = _context()
            swap = next(d for d in engine if d.kind == D.KIND_SWAP)
            second = _submit(client, ctx2, swap.word).json()
        assert second["rule_update"]["n"] == 2
        assert sum(store.load(UID, "amis").confusions.values()) == 1

    def test_client_supplied_rule_state_is_ignored(self, client, store):
        _, _, ctx = _context()
        forged = {"rule_skills": {MA_ID: {"p": 0.99, "n": 99, "c": 99, "v": "x"}}, "rule_confusions": {}}
        with _flags(**ALL_ON):
            body = _submit(client, ctx, "mafilo", user_data=forged).json()
        assert body["rule_update"]["before"] == R.P_INIT and body["rule_update"]["n"] == 1

    def test_the_irt_result_is_identical_with_and_without_diagnosis(self, client, store):
        _, _, ctx = _context()
        with _flags():
            off = _submit(client, ctx, "mafilo").json()
        with _flags(**ALL_ON):
            on = _submit(client, ctx, "mafilo").json()
        assert off["new_theta"] == on["new_theta"] and off["updated_user_errors"] == on["updated_user_errors"]

    def test_a_client_lying_about_correctness_cannot_split_irt_from_the_diagnosis(self, client, store):
        _, engine, ctx = _context()
        swap = next(d for d in engine if d.kind == D.KIND_SWAP)
        with _flags(**ALL_ON):
            honest = _submit(client, ctx, swap.word, correct=False).json()
            lying = _submit(client, ctx, swap.word, correct=True).json()           # 選了錯的，謊稱答對
            lying_right = _submit(client, ctx, "mafilo", correct=False).json()      # 選了對的，謊稱答錯
        assert lying["new_theta"] == honest["new_theta"]
        assert lying["updated_user_errors"]["mafilo"]["errors"] == honest["updated_user_errors"]["mafilo"]["errors"]
        assert lying_right["updated_user_errors"]["mafilo"]["errors"] == 0

    def test_without_diagnosis_the_client_value_still_drives_irt(self, client, store):
        _, _, ctx = _context()
        with _flags():
            right = _submit(client, ctx, "mafilo", correct=True).json()
            wrong = _submit(client, ctx, "mafilo", correct=False).json()
        assert right["new_theta"] > wrong["new_theta"]

    def test_forged_token_cannot_update_anything(self, client, store):
        _, _, ctx = _context()
        with _flags(**ALL_ON), patch.object(D, "get_kit", return_value=None):
            body = _submit(client, ctx, "mafilo", question_token=G.encode_token(ctx)[:-3] + "xyz").json()
        assert body["rule_update"] is None and store.load(UID, "amis").skills == {}

    def test_another_users_token_cannot_update_this_users_state(self, store):
        _, _, ctx = _context()
        thief = _make_client("mallory")
        try:
            with thief, _flags(**ALL_ON), patch.object(D, "get_kit", return_value=None):
                body = _submit(thief, ctx, "mafilo").json()
        finally:
            app.dependency_overrides.clear()
        assert body["rule_update"] is None and body["diagnosis"]["confidence"] == "medium"
        assert store.load("mallory", "amis").skills == {} and store.load(UID, "amis").skills == {}

    def test_diagnosis_crash_does_not_break_the_answer(self, client, store):
        _, _, ctx = _context()
        with _flags(**ALL_ON), patch.object(G, "diagnose_with_context", side_effect=RuntimeError("boom")):
            resp = _submit(client, ctx, "mafilo")
        assert resp.status_code == 200 and resp.json()["diagnosis"] is None and "new_theta" in resp.json()

    def test_store_outage_does_not_break_the_answer(self, client, store):
        _, _, ctx = _context()
        with _flags(**ALL_ON), patch.object(store, "apply", side_effect=rule_state_store.StoreError("down")):
            resp = _submit(client, ctx, "mafilo")
        assert resp.status_code == 200 and resp.json()["rule_update"] == {"unavailable": "error"}
        assert resp.json()["diagnosis"]["status"] == "correct"

    def test_other_question_types_are_unaffected(self, client, store):
        _, _, ctx = _context()
        with _flags(**ALL_ON):
            body = _submit(client, ctx, "mafilo", question_type="word-translate").json()
        assert body["diagnosis"] is None and store.load(UID, "amis").skills == {}

    def test_overlong_fields_are_rejected_by_validation(self, client, store):
        _, _, ctx = _context()
        assert _submit(client, ctx, "x" * 201).status_code == 422
        assert _submit(client, ctx, "mafilo", question_token="a" * 9000).status_code == 422

    def test_event_recording_happens_after_the_irt_update_and_cannot_break_it(self, client, store):
        _, _, ctx = _context()
        with _flags(**ALL_ON), patch.object(answer_flow.research_events, "record_skill_event", side_effect=RuntimeError("x")):
            resp = _submit(client, ctx, "mafilo")
        assert resp.status_code == 200 and resp.json()["diagnosis"]["status"] == "correct"

    def test_the_ability_prediction_is_made_before_this_answer_is_counted(self, client, store):
        # 同一題、同樣的使用者統計：答對與答錯記下的 pred_ability 必須一樣（不能含這一題的答案），
        # 而且等於「只用作答前統計」手算的值。
        prior = {"ability": 0.6, "user_errors": {"mafilo": {"attempts": 4, "errors": 1, "recent_results": [0, 1, 0, 0],
                                                            "recent_times": [3.0], "avg_time": 3.0}},
                 "type_stats": {"sentence-fill": {"e": 3, "n": 10}}}
        seen = []

        def capture(uid, event):
            seen.append(event)
            return True
        with _flags(**ALL_ON), patch.object(answer_flow.research_events, "record_skill_event", side_effect=capture):
            _, _, right_ctx = _context()
            _submit(client, right_ctx, "mafilo", user_data=prior)
            _, engine, wrong_ctx = _context()
            swap = next(d for d in engine if d.kind == D.KIND_SWAP)
            _submit(client, wrong_ctx, swap.word, user_data=prior)
        right, wrong = seen
        assert right["correct"] is True and wrong["correct"] is False
        assert right["pred_ability"] == wrong["pred_ability"]

        from fastAPI.routes.quiz import irt
        words = [WordDTO(id=f"w{i}", name=f"word{i}", frequency=1) for i in range(5)]
        fprime = irt.compute_normalized_freq_map(words).get("mafilo", 0.0)
        _, bw = irt.compute_Dq_and_bw(irt.compute_smoothed_error_rate(1, 4), irt.compute_smoothed_error_rate(3, 10), fprime)
        expected = irt.compute_P_theta(0.6, bw, irt.TYPE_AQ["sentence-fill"], irt.DEFAULT_GUESS)
        assert right["pred_ability"] == round(expected, 4)

    def test_event_receives_the_pre_update_predictions(self, client, store):
        _, _, ctx = _context()
        with _flags(**ALL_ON), patch.object(answer_flow.research_events, "record_skill_event", return_value=True) as rec:
            _submit(client, ctx, "mafilo")
        uid, event = rec.call_args.args
        assert uid == UID and event["pred_skill"] == R.overall_rate(None) and event["p_before"] == R.P_INIT
        assert 0 < event["pred_ability"] < 1 and event["probe"] is True


class TestGenerateEndpoint:
    def _post(self, client):
        words = [WordDTO(id=f"w{i}", name=f"word{i}", frequency=i + 1) for i in range(40)]
        with patch("fastAPI.routes.quiz.api.load_all_words", return_value=words):
            return client.post("/api/v1/quiz/generate_quiz_frontend?tribe=amis", json={})

    def test_diagnosis_flag_off_never_passes_token_options(self, client, store):
        with _flags(), patch("fastAPI.routes.quiz.api._generate_sentence_fill_questions", return_value=[]) as gen:
            assert self._post(client).status_code == 200
        assert gen.call_args.kwargs["token_options"] is None

    def test_diagnosis_flag_on_passes_token_options_for_the_tribe_and_user(self, client, store):
        with _flags(**{flags.DIAGNOSIS: True}), patch("fastAPI.routes.quiz.api._generate_sentence_fill_questions", return_value=[]) as gen:
            assert self._post(client).status_code == 200
        opts = gen.call_args.kwargs["token_options"]
        assert (opts.tribe, opts.uid, opts.policy) == ("amis", UID, "baseline")

    def test_flag_on_without_a_usable_secret_gives_no_token_options_and_warns_once(self, client, store, monkeypatch):
        from fastAPI.routes.quiz import api as quiz_api
        monkeypatch.delenv(G.SECRET_ENV)
        monkeypatch.setattr(quiz_api, "_warned_missing_secret", False)
        with _flags(**{flags.DIAGNOSIS: True}), patch("fastAPI.routes.quiz.api._generate_sentence_fill_questions", return_value=[]) as gen,              patch.object(quiz_api, "logger") as log:
            assert self._post(client).status_code == 200
            assert self._post(client).status_code == 200
        assert gen.call_args.kwargs["token_options"] is None
        assert log.warning.call_count == 1 and "QUIZ_TOKEN_SECRET" in log.warning.call_args.args[0]

    def test_a_weak_secret_counts_as_missing(self, client, store, monkeypatch):
        from fastAPI.routes.quiz import api as quiz_api
        monkeypatch.setenv(G.SECRET_ENV, "0" * 40)
        monkeypatch.setattr(quiz_api, "_warned_missing_secret", False)
        with _flags(**{flags.DIAGNOSIS: True}), patch("fastAPI.routes.quiz.api._generate_sentence_fill_questions", return_value=[]) as gen:
            self._post(client)
        assert gen.call_args.kwargs["token_options"] is None
