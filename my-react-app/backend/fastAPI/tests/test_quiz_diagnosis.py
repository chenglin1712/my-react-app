"""routes/quiz/diagnosis.py：出題 token 與錯誤診斷。

要鎖住的行為：
- token 是驗證式加密：只有持有密鑰的伺服器能產生與解開，前端看不到內容；竄改、過期、發行時間不合理、
  換使用者／題目／族語／目標詞、格式不對都驗證失敗（None），不丟例外；沒設定密鑰（或密鑰太弱）就不簽
  token（降級，不是出題失敗）；
- 診斷依出題當下的選項來源判斷，順序是 invalid → correct → 引擎干擾項 → 隨機選項；
- 規則歸屬有歧義、隨機選項跟目標詞同詞根時，不硬分類；
- 只有「token 驗證過 + 這題真的在測那條規則」才會產生熟練度更新；
- 沒有 token 時只做高信心的重算，而且絕不更新熟練度。
"""
import random

import pytest

from config import morphology as M
from config import rule_skill_model as R
from fastAPI.routes.quiz import diagnosis as G
from fastAPI.routes.quiz import distractors as D

MA = M.MorphRule("P", a="ma")
PA = M.MorphRule("P", a="pa")
PI = M.MorphRule("P", a="pi")
IN1 = M.MorphRule("I", a="in", k=1)
SECRET = "unit-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz"
UID = "user-1"
NOW = 1_800_000_000


def _kit(*, lexicon=(), attested=(), derived=None, rules=None, version="kv1"):
    rules = rules if rules is not None else {MA: 50, PA: 40, PI: 30, IN1: 20}
    shifted = [M.MorphRule("I", r.a, k=k) for r in rules if r.kind == "I" for k in range(1, 5)]
    stats = {(a, b): (100, 0) for a in rules for b in [*rules, *shifted] if a != b}
    return D.TribeKit(frozenset(lexicon), frozenset(attested), derived or {}, rules, stats, version)


def _context(*, with_random=True, policy="baseline", derived=None, lexicon=None, rules=None, now=NOW):
    derived = derived if derived is not None else {"mafilo": ("filo",)}
    kit = _kit(lexicon=lexicon if lexicon is not None else {"mafilo", "filo", "balay"}, derived=derived, rules=rules)
    engine = D.distractors_for(kit, "mafilo", 2, rng=random.Random(1))
    words = ["mafilo"] + [d.word for d in engine] + (["balay"] if with_random else [])
    ctx = G.build_context("sf-1-0", "amis", "mafilo", words, engine, kit, uid=UID, policy=policy, now=now)
    return kit, engine, ctx


class TestBuildContext:
    def test_roles_and_rule_ids(self):
        kit, engine, ctx = _context()
        by_word = {o.word: o for o in ctx.options}
        assert by_word["mafilo"].role == G.ROLE_TARGET
        assert by_word["balay"].role == G.ROLE_RANDOM and by_word["balay"].shares_root is False
        for d in engine:
            assert by_word[d.word].role == G.ROLE_ENGINE and by_word[d.word].kind == d.kind
            assert R.parse_rule_id(by_word[d.word].rule_id) is not None
        assert ctx.target_rule_id == R.rule_id("amis", "P", "ma")
        assert ctx.kit_version == "kv1" and ctx.policy == "baseline" and ctx.expires_at == NOW + G.TOKEN_TTL_SECONDS
        assert ctx.uid == UID and ctx.issued_at == NOW
        assert len(ctx.nonce) == 16

    def test_probe_requires_unique_target_rule_and_an_engine_option(self):
        _, _, with_engine = _context()
        assert with_engine.probe is True
        _, _, all_random = _context(derived={}, lexicon={"mafilo", "balay"})
        assert all_random.target_rule_id is None and all_random.probe is False

    def test_ambiguous_target_is_never_a_probe(self):
        # 同一對 (衍生詞, 詞根) 有兩條常見規則：tatalo = 前綴 ta- + talo，也是中綴 -at-（第 1 個字母後）
        ta, at = M.MorphRule("P", a="ta"), M.MorphRule("I", a="at", k=1)
        kit = _kit(lexicon={"tatalo"}, derived={"tatalo": ("talo",)}, rules={ta: 50, at: 40, PA: 30})
        detail = D.recover_rule_detail(kit, "tatalo")
        assert detail is not None and detail[1] == ta and detail[2] is True
        engine = [D.Distractor("x", D.KIND_SWAP, "n")]
        ctx = G.build_context("q", "amis", "tatalo", ["tatalo", "x"], engine, kit, now=NOW)
        assert any(o.role == G.ROLE_ENGINE for o in ctx.options)          # 有引擎選項，唯一讓它不是 probe 的原因是歧義
        assert ctx.ambiguous is True and ctx.probe is False

    def test_a_known_unique_rule_without_any_engine_option_is_not_a_probe(self):
        kit = _kit(lexicon={"mafilo", "filo", "balay"}, derived={"mafilo": ("filo",)})
        ctx = G.build_context("q", "amis", "mafilo", ["mafilo", "balay"], [], kit, now=NOW)
        assert ctx.target_rule_id == R.rule_id("amis", "P", "ma") and ctx.ambiguous is False
        assert ctx.probe is False                                         # 全是隨機選項：答對只代表認得那個詞

    def test_random_option_sharing_a_root_with_the_target_is_flagged(self):
        kit = _kit(lexicon={"mafilo", "filo", "pafilo"}, derived={"mafilo": ("filo",), "pafilo": ("filo",)})
        ctx = G.build_context("q", "amis", "mafilo", ["mafilo", "pafilo"], [], kit, now=NOW)
        assert [o.shares_root for o in ctx.options] == [False, True]

    def test_random_option_that_is_the_root_itself_is_flagged(self):
        kit = _kit(lexicon={"mafilo", "filo"}, derived={"mafilo": ("filo",)})
        ctx = G.build_context("q", "amis", "mafilo", ["mafilo", "filo"], [], kit, now=NOW)
        assert ctx.options[1].shares_root is True

    def test_nonce_differs_between_questions(self):
        assert _context()[2].nonce != _context()[2].nonce


class TestToken:
    def test_round_trip(self):
        _, _, ctx = _context(policy="adaptive-explore")
        back = G.decode_token(G.encode_token(ctx, SECRET), secrets=[SECRET], now=NOW)
        assert back == ctx

    def test_token_content_is_opaque_to_the_client(self):
        _, engine, ctx = _context(policy="adaptive-explore")
        token = G.encode_token(ctx, SECRET)
        for secret_text in ("adaptive-explore", "mafilo", UID, ctx.target_rule_id, ctx.nonce, "engine", "kv1"):
            assert secret_text not in token
            import base64
            padded = token + "=" * (-len(token) % 4)
            try:
                decoded = base64.urlsafe_b64decode(padded).decode("latin-1")
            except Exception:
                decoded = ""
            assert secret_text not in decoded                      # 連 base64 解開一層也看不到明文

    def test_no_secret_means_no_token(self, monkeypatch):
        monkeypatch.delenv(G.SECRET_ENV, raising=False)
        assert G.encode_token(_context()[2]) is None
        assert G.encode_token(_context()[2], "short") is None

    @pytest.mark.parametrize("weak", ["0" * 40, "ab" * 20, "a" * 31, "abcdefghijklmnopqrstuvwxyz01234"])
    def test_weak_secrets_are_refused(self, weak):
        assert G.encode_token(_context()[2], weak) is None

    def test_secret_policy_boundary(self):
        assert G._usable("abcdefghij" + "a" * 22) is True               # 剛好 32 字元、10 種字元
        assert G._usable("abcdefghi" + "a" * 23) is False               # 32 字元但只有 9 種字元
        assert G._usable("abcdefghij" + "a" * 21) is False              # 10 種字元但只有 31 字元
        assert G._usable(None) is False and G._usable("") is False

    def test_env_secret_is_used_and_must_be_strong_enough(self, monkeypatch):
        _, _, ctx = _context()
        monkeypatch.setenv(G.SECRET_ENV, "tooshort")
        assert G.encode_token(ctx) is None
        monkeypatch.setenv(G.SECRET_ENV, SECRET)
        token = G.encode_token(ctx)
        assert token and G.decode_token(token, now=NOW) == ctx

    def test_wrong_secret_fails(self):
        token = G.encode_token(_context()[2], SECRET)
        assert G.decode_token(token, secrets=["another-secret-0123456789-abcdefghijklmnop"], now=NOW) is None

    def test_no_configured_secret_fails_closed(self, monkeypatch):
        monkeypatch.delenv(G.SECRET_ENV, raising=False)
        monkeypatch.delenv(G.PREVIOUS_SECRET_ENV, raising=False)
        token = G.encode_token(_context()[2], SECRET)
        assert G.decode_token(token, now=NOW) is None

    def test_previous_secret_still_verifies_during_rotation(self, monkeypatch):
        old = "old-secret-0123456789abcdef-ghijklmnopqrstuv"
        token = G.encode_token(_context()[2], old)
        monkeypatch.setenv(G.SECRET_ENV, SECRET)
        monkeypatch.setenv(G.PREVIOUS_SECRET_ENV, old)
        assert G.decode_token(token, now=NOW) is not None
        monkeypatch.delenv(G.PREVIOUS_SECRET_ENV)
        assert G.decode_token(token, now=NOW) is None

    def test_tampered_token_fails(self):
        token = G.encode_token(_context()[2], SECRET)
        for index in (5, len(token) // 2, len(token) - 5):
            flipped = token[:index] + ("A" if token[index] != "A" else "B") + token[index + 1:]
            assert G.decode_token(flipped, secrets=[SECRET], now=NOW) is None
        assert G.decode_token(token[:-4], secrets=[SECRET], now=NOW) is None

    def test_expiry_boundary_is_exclusive(self):
        _, _, ctx = _context()
        token = G.encode_token(ctx, SECRET)
        assert G.decode_token(token, secrets=[SECRET], now=ctx.expires_at - 1) is not None
        assert G.decode_token(token, secrets=[SECRET], now=ctx.expires_at) is None
        assert G.decode_token(token, secrets=[SECRET], now=ctx.expires_at + 1) is None

    def test_issued_in_the_future_is_rejected_but_small_clock_skew_is_tolerated(self):
        _, _, ctx = _context()
        token = G.encode_token(ctx, SECRET)
        assert G.decode_token(token, secrets=[SECRET], now=NOW - G.CLOCK_SKEW_SECONDS) is not None
        assert G.decode_token(token, secrets=[SECRET], now=NOW - G.CLOCK_SKEW_SECONDS - 1) is None

    @pytest.mark.parametrize("bad", [None, 5, "", "abc", "a.b.c", "x" * (G.MAX_TOKEN_LEN + 1), b"bytes", "é" * 50])
    def test_garbage_never_raises(self, bad):
        assert G.decode_token(bad, secrets=[SECRET], now=NOW) is None

    def _craft(self, mutate):
        _, _, ctx = _context()
        data = {"v": G.TOKEN_VERSION, "q": ctx.question_id, "t": ctx.tribe, "w": ctx.target, "u": ctx.uid,
                "r": ctx.target_rule_id, "a": 0,
                "o": [[o.word, o.role, o.kind, o.rule_id, int(o.shares_root)] for o in ctx.options],
                "k": ctx.kit_version, "p": ctx.policy, "n": ctx.nonce, "i": ctx.issued_at, "e": ctx.expires_at}
        mutate(data)
        return G._encrypt(data, SECRET)                            # 加密與簽章都正確，但內容不合法

    def test_the_crafted_baseline_is_valid(self):
        assert G.decode_token(self._craft(lambda d: None), secrets=[SECRET], now=NOW) is not None

    @pytest.mark.parametrize("mutate", [
        lambda d: d.__setitem__("v", 1),
        lambda d: d.__setitem__("e", "soon"),
        lambda d: d.__setitem__("e", True),
        lambda d: d.__setitem__("i", "x"),
        lambda d: d.__setitem__("e", d["i"] + G.TOKEN_TTL_SECONDS * 100),         # 有效期太長
        lambda d: d.__setitem__("e", d["i"]),                                      # 有效期為 0
        lambda d: d.__setitem__("o", []),
        lambda d: d.__setitem__("o", [["x", "target", None, None, 0]] * 9),
        lambda d: d.__setitem__("o", [["a", "boss", None, None, 0]]),
        lambda d: d.__setitem__("o", [["a", "engine", None, "bad-rule-id", 0]]),
        lambda d: d.__setitem__("o", [["a", "target", None, None, 5]]),
        lambda d: d.__setitem__("o", [["a", "target"]]),
        lambda d: d.__setitem__("o", [["a", "random", None, None, 0]]),                 # 沒有正解
        lambda d: d.__setitem__("o", [["a", "target", None, None, 0], ["b", "target", None, None, 0]]),  # 兩個正解
        lambda d: d.__setitem__("r", "bad"),
        lambda d: d.__setitem__("a", 2),
        lambda d: d.__setitem__("q", 7),
        lambda d: d.__setitem__("u", 7),
        lambda d: d.pop("k"),
        lambda d: d.pop("u"),
        lambda d: d.__setitem__("w", "x" * 300),
    ])
    def test_validly_encrypted_but_malformed_payload_is_rejected(self, mutate):
        assert G.decode_token(self._craft(mutate), secrets=[SECRET], now=NOW) is None

    def test_verify_for_answer_binds_user_question_tribe_and_target(self):
        _, _, ctx = _context()
        token = G.encode_token(ctx, SECRET)
        ok = dict(question_id="sf-1-0", tribe="amis", word_name="mafilo", uid=UID, secrets=[SECRET], now=NOW)
        assert G.verify_for_answer(token, **ok) == ctx
        for field, value in (("question_id", "sf-2-0"), ("tribe", "tayal"), ("word_name", "pafilo"),
                             ("uid", "someone-else"), ("uid", "")):
            assert G.verify_for_answer(token, **{**ok, field: value}) is None

    def test_a_token_issued_without_a_uid_can_never_verify(self):
        kit, engine, _ = _context()
        anonymous = G.build_context("sf-1-0", "amis", "mafilo", ["mafilo", "balay"], engine, kit, now=NOW)
        token = G.encode_token(anonymous, SECRET)
        assert G.verify_for_answer(token, question_id="sf-1-0", tribe="amis", word_name="mafilo", uid="",
                                   secrets=[SECRET], now=NOW) is None


class TestDiagnoseWithContext:
    def test_selected_target_is_correct(self):
        _, _, ctx = _context()
        d = G.diagnose_with_context(ctx, "mafilo")
        assert (d.status, d.error_type, d.confidence, d.probe) == (G.STATUS_CORRECT, None, "high", True)

    def test_engine_swap_is_wrong_affix(self):
        _, engine, ctx = _context()
        swap = next(x for x in engine if x.kind == D.KIND_SWAP)
        d = G.diagnose_with_context(ctx, swap.word)
        assert (d.status, d.error_type) == (G.STATUS_CLASSIFIED, G.ERR_AFFIX)
        assert d.target_rule_id == R.rule_id("amis", "P", "ma")
        assert d.selected_rule_id == G.rule_id_for("amis", swap.used_rule)

    def test_engine_shift_is_wrong_position(self):
        kit = _kit(lexicon={"kinilo", "kilo"}, derived={"kinilo": ("kilo",)}, rules={IN1: 30, MA: 20})
        # "kinilo" = 詞根 kilo + 中綴 in 在第 1 個字母之後
        engine = [d for d in D.distractors_for(kit, "kinilo", 5, rng=random.Random(2)) if d.kind == D.KIND_SHIFT]
        assert engine
        ctx = G.build_context("q", "tayal", "kinilo", ["kinilo", engine[0].word], engine[:1], kit, now=NOW)
        d = G.diagnose_with_context(ctx, engine[0].word)
        assert (d.status, d.error_type) == (G.STATUS_CLASSIFIED, G.ERR_POSITION)
        parsed = R.parse_rule_id(d.selected_rule_id)
        assert parsed[1] == "I" and parsed[2] == "in" and parsed[4] != 1       # 同一個中綴，位置不同

    def test_random_option_with_different_root_is_wrong_root(self):
        _, _, ctx = _context()
        d = G.diagnose_with_context(ctx, "balay")
        assert (d.status, d.error_type, d.reason, d.selected_rule_id) == (G.STATUS_CLASSIFIED, G.ERR_ROOT, "random_distractor", None)

    def test_random_option_sharing_a_root_is_ambiguous_not_wrong_root(self):
        kit = _kit(lexicon={"mafilo", "filo", "pafilo"}, derived={"mafilo": ("filo",), "pafilo": ("filo",)})
        ctx = G.build_context("q", "amis", "mafilo", ["mafilo", "pafilo"], [], kit, now=NOW)
        d = G.diagnose_with_context(ctx, "pafilo")
        assert (d.status, d.error_type, d.reason) == (G.STATUS_AMBIGUOUS, None, "random_shares_root")

    def test_option_not_in_the_question_is_invalid(self):
        _, _, ctx = _context()
        d = G.diagnose_with_context(ctx, "zzz")
        assert d.status == G.STATUS_INVALID and G.skill_observation(d) is None

    def test_engine_option_with_ambiguous_target_is_ambiguous(self):
        _, engine, ctx = _context()
        ambiguous_ctx = G.QuestionContext(ctx.question_id, ctx.tribe, ctx.target, ctx.options, ctx.target_rule_id,
                                          True, ctx.kit_version, ctx.policy, ctx.nonce, ctx.expires_at)
        d = G.diagnose_with_context(ambiguous_ctx, engine[0].word)
        assert (d.status, d.reason) == (G.STATUS_AMBIGUOUS, "target_rule_ambiguous")

    def test_engine_option_with_unknown_kind_is_unclassified(self):
        _, engine, ctx = _context()
        options = tuple(G.OptionInfo(o.word, o.role, "mystery" if o.role == G.ROLE_ENGINE else o.kind, o.rule_id) for o in ctx.options)
        weird = G.QuestionContext(ctx.question_id, ctx.tribe, ctx.target, options, ctx.target_rule_id, False,
                                  ctx.kit_version, ctx.policy, ctx.nonce, ctx.expires_at)
        assert G.diagnose_with_context(weird, engine[0].word).status == G.STATUS_UNCLASSIFIED

    def test_diagnosis_carries_context_metadata(self):
        _, _, ctx = _context(policy="adaptive-exploit")
        d = G.diagnose_with_context(ctx, "mafilo")
        assert (d.kit_version, d.policy, d.nonce) == ("kv1", "adaptive-exploit", ctx.nonce)
        assert d.as_dict()["errorType"] is None and d.as_dict()["targetRule"] == ctx.target_rule_id


class TestSkillObservation:
    def test_correct_on_a_probe_updates_target_positively(self):
        _, _, ctx = _context()
        d = G.diagnose_with_context(ctx, "mafilo")
        assert G.skill_observation(d) == (ctx.target_rule_id, True)

    def test_affix_and_position_errors_update_target_negatively(self):
        _, engine, ctx = _context()
        for x in engine:
            d = G.diagnose_with_context(ctx, x.word)
            assert G.skill_observation(d) == (ctx.target_rule_id, False)

    def test_wrong_root_does_not_touch_skills(self):
        _, _, ctx = _context()
        assert G.skill_observation(G.diagnose_with_context(ctx, "balay")) is None

    def test_non_probe_questions_never_update(self):
        _, _, ctx = _context(derived={}, lexicon={"mafilo", "balay"})
        assert G.skill_observation(G.diagnose_with_context(ctx, "mafilo")) is None

    def test_medium_confidence_never_updates(self):
        d = G.Diagnosis(G.STATUS_CORRECT, None, "v1|amis|P|ma||0", None, "medium", "x", probe=True)
        assert G.skill_observation(d) is None

    def test_missing_target_rule_never_updates(self):
        d = G.Diagnosis(G.STATUS_CORRECT, None, None, None, "high", "x", probe=True)
        assert G.skill_observation(d) is None

    def test_ambiguous_and_unclassified_wrong_answers_do_not_update(self):
        rid = R.rule_id("amis", "P", "ma")
        for status in (G.STATUS_AMBIGUOUS, G.STATUS_UNCLASSIFIED, G.STATUS_INVALID):
            assert G.skill_observation(G.Diagnosis(status, None, rid, None, "high", "x", probe=True)) is None
        # 已分類但錯因是詞根：不更新
        assert G.skill_observation(G.Diagnosis(G.STATUS_CLASSIFIED, G.ERR_ROOT, rid, None, "high", "x", probe=True)) is None


class TestRecomputeFallback:
    def _kit_amis(self):
        return _kit(lexicon={"mafilo", "filo"}, derived={"mafilo": ("filo",)})

    def test_exact_candidate_is_classified_with_medium_confidence(self):
        kit = self._kit_amis()
        d = G.diagnose_by_recompute(kit, "amis", "mafilo", "pafilo")
        assert (d.status, d.error_type, d.confidence, d.probe) == (G.STATUS_CLASSIFIED, G.ERR_AFFIX, "medium", False)
        assert d.selected_rule_id == R.rule_id("amis", "P", "pa") and d.kit_version == "kv1"
        assert G.skill_observation(d) is None

    def test_correct_choice(self):
        d = G.diagnose_by_recompute(self._kit_amis(), "amis", "mafilo", "Mafilo")
        assert d.status == G.STATUS_CORRECT and G.skill_observation(d) is None

    def test_unrelated_word_is_unclassified_not_wrong_root(self):
        d = G.diagnose_by_recompute(self._kit_amis(), "amis", "mafilo", "balay")
        assert (d.status, d.error_type, d.reason) == (G.STATUS_UNCLASSIFIED, None, "no_matching_candidate")

    def test_no_kit_target_unknown_and_empty_forms(self):
        assert G.diagnose_by_recompute(None, "amis", "mafilo", "pafilo").reason == "no_kit"
        assert G.diagnose_by_recompute(self._kit_amis(), "amis", "", "pafilo").reason == "empty_form"
        assert G.diagnose_by_recompute(self._kit_amis(), "amis", "mafilo", "").reason == "empty_form"
        assert G.diagnose_by_recompute(_kit(derived={}), "amis", "mafilo", "pafilo").reason == "target_rule_unknown"

    def test_infix_position_error(self):
        kit = _kit(lexicon={"kinilo", "kilo"}, derived={"kinilo": ("kilo",)}, rules={IN1: 30, MA: 20})
        d = G.diagnose_by_recompute(kit, "tayal", "kinilo", "kiinlo")
        assert (d.status, d.error_type) == (G.STATUS_CLASSIFIED, G.ERR_POSITION)

    def test_ambiguous_target_is_not_classified(self):
        ta, at = M.MorphRule("P", a="ta"), M.MorphRule("P", a="pa")
        at_infix = M.MorphRule("I", a="at", k=1)
        kit = _kit(lexicon={"tatalo"}, derived={"tatalo": ("talo",)}, rules={ta: 50, at_infix: 40, at: 30})
        d = G.diagnose_by_recompute(kit, "amis", "tatalo", "patalo")
        assert d.status == G.STATUS_AMBIGUOUS and d.reason == "ambiguous_rule"

    def test_form_matching_two_different_rules_is_ambiguous(self):
        # 詞根 tata：中綴 a 放第 1、第 2 個字母之後都是 taata，所選 "taata" 同時對應兩個位置
        rule0 = M.MorphRule("I", "a", k=3)
        kit = _kit(lexicon={"tatsince"}, derived={"tataata": ("tata",)}, rules={rule0: 30, MA: 10})
        d = G.diagnose_by_recompute(kit, "tayal", "tataata", "taata")
        assert d.status in (G.STATUS_AMBIGUOUS, G.STATUS_UNCLASSIFIED)
