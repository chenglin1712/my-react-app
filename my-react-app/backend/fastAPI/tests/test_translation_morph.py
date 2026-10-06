"""詞形分析器接進翻譯佐證檢核（fastAPI/routes/translation/morph.py 與 retrieve.py、
service.py 的整合點）的測試。

最重要的是鎖住幾個「不能壞」的安全性質：
- 旗標關閉（或沒有探針）時，輸出與完全沒有這個功能時逐位相同；
- 分析器只【追加】候選，原本就能判成 derived 的 token，lemma／note 不變；
- 分析器只對 Phase 1 沒命中的單一 token 生效，不碰 headword／attested／多詞詞條；
- 分析器的候選仍要通過資料庫查詢才算 derived；
- 載入失敗（放行檔缺失／格式錯／規則非法／指紋不符）一律停用，絕不丟例外；
- 兩個旗標預設都是 False（fail-closed），都關閉時連放行檔都不讀。

資料庫整個用 FakeDb 與 patch 取代，不需要 PostgreSQL。
"""
import json
import time
from unittest.mock import MagicMock, patch

import pytest

from config import morphology as M
from config import morphology_calibration as C
from config import translation_lexicon as lexicon
from config.morphology import MorphRule
from config.tribes import TRIBES
from fastAPI.routes.translation import morph
from fastAPI.routes.translation import retrieve as R
from fastAPI.routes.translation import service as S

@pytest.fixture(autouse=True)
def _keep_morph_warnings_out_of_the_real_log_file():
    """這個檔案刻意製造大量載入失敗的情境，每個都會記一筆 warning。fastAPI 的日誌設定會寫進
    真實的 fastapi.log，不關掉的話一次測試就在開發環境的日誌裡灌進上千行假警告。測試裡要驗證
    記錄行為的地方是直接攔截 logger.info／檢查回傳的 reason，不依賴日誌輸出。"""
    previous = morph.logger.disabled
    morph.logger.disabled = True
    yield
    morph.logger.disabled = previous


_TRIBE = next(t for t in TRIBES if t.slug == "kavalan")
_TRIBE_ID = _TRIBE.id
P_MA = MorphRule("P", a="ma")


def _word(name, gloss="釋義"):
    return R.WordMatch(id=f"id-{name}", name=name, gloss=gloss, audio_file_id=None)


def _probe(shadow=False, rules=None, lexicon_set=None, functions=None):
    rules = rules or {P_MA: 20}
    analyzer = M.MorphAnalyzer(rules, lexicon_set or {"filo", "alaw", "law"},
                               precision={r: 0.9 for r in rules}, rank_by="precision", max_edit=0)
    return morph.MorphProbe(analyzer, functions if functions is not None else {"ma-": "前綴功能"}, "tid", shadow)


def _lookup_from(headwords):
    """依傳入的 forms 回傳 headwords 字典裡有的部分——比固定回傳值更接近真實查詢。"""
    def fake(db, tribe_id, forms):
        return {f: headwords[f] for f in forms if f in headwords}
    return fake


# ---------------------------------------------------------------------------
# 整合點：corroborate_tokens
# ---------------------------------------------------------------------------

class TestCorroborateWithMorph:
    def _run(self, tokens, headwords=None, attested=None, strip_rules=None, morph_probe=None):
        with patch.object(R, "lookup_headwords_batch", side_effect=_lookup_from(headwords or {})), \
             patch.object(R, "lookup_attested_batch", side_effect=lambda db, t, forms: {f: 7 for f in forms if f in (attested or {})}):
            return R.corroborate_tokens(None, _TRIBE_ID, tokens, strip_rules=strip_rules, morph=morph_probe)

    def test_morph_none_is_identical_to_not_passing_the_argument(self):
        sr = lexicon.build_strip_rules([{"affix": "m-", "function": "主事焦點"}])
        hw = {"alaw": _word("alaw", "打獵")}
        with patch.object(R, "lookup_headwords_batch", side_effect=_lookup_from(hw)), \
             patch.object(R, "lookup_attested_batch", return_value={}):
            omitted = R.corroborate_tokens(None, _TRIBE_ID, ["malaw", "zzzz"], strip_rules=sr)
            explicit = R.corroborate_tokens(None, _TRIBE_ID, ["malaw", "zzzz"], strip_rules=sr, morph=None)
        assert omitted == explicit
        assert [s.status for s in omitted] == ["derived", "unsupported"]

    def test_unsupported_token_is_upgraded_when_the_analyzer_finds_a_root_in_the_dictionary(self):
        spans = self._run(["mafilo"], headwords={"filo": _word("filo", "魚")}, morph_probe=_probe())
        assert spans[0].status == "derived"
        assert spans[0].lemma == "filo" and spans[0].gloss == "魚"
        assert "ma-" in spans[0].note and "前綴功能" in spans[0].note and "推定" in spans[0].note

    def test_without_the_probe_the_same_token_stays_unsupported(self):
        assert self._run(["mafilo"], headwords={"filo": _word("filo")})[0].status == "unsupported"

    def test_the_analyzer_candidate_must_still_be_confirmed_by_the_database(self):
        # 分析器的詞庫說 "filo" 存在，但資料庫查詢沒找到——不能升級。
        spans = self._run(["mafilo"], headwords={}, morph_probe=_probe())
        assert spans[0].status == "unsupported"

    def test_candidates_are_appended_so_existing_derived_results_do_not_change(self):
        # strip 規則 m- 把 "malaw" 剝成 "alaw"（詞庫有）；分析器的 P(ma) 會剝成 "law"（詞庫也有）。
        # 既有候選排在前面，所以結果必須跟沒有分析器時完全一樣（lemma、note 都不變）。
        sr = lexicon.build_strip_rules([{"affix": "m-", "function": "主事焦點"}])
        hw = {"alaw": _word("alaw", "打獵"), "law": _word("law", "別的詞")}
        baseline = self._run(["malaw"], headwords=hw, strip_rules=sr)[0]
        with_morph = self._run(["malaw"], headwords=hw, strip_rules=sr, morph_probe=_probe())[0]
        assert baseline == with_morph
        assert with_morph.lemma == "alaw" and "主事焦點" in with_morph.note

    def test_works_without_strip_rules(self):
        spans = self._run(["mafilo"], headwords={"filo": _word("filo")}, strip_rules=None, morph_probe=_probe())
        assert spans[0].status == "derived"

    def test_headword_tokens_are_never_sent_to_the_analyzer(self):
        probe = MagicMock()
        probe.shadow = False
        spans = self._run(["mafilo"], headwords={"mafilo": _word("mafilo")}, morph_probe=probe)
        assert spans[0].status == "headword"
        probe.candidates.assert_not_called()

    def test_attested_tokens_are_never_sent_to_the_analyzer(self):
        probe = MagicMock()
        probe.shadow = False
        spans = self._run(["mafilo"], attested={"mafilo": 1}, morph_probe=probe)
        assert spans[0].status == "attested"
        probe.candidates.assert_not_called()

    def test_multi_token_headwords_are_unaffected(self):
        probe = MagicMock()
        probe.shadow = False
        spans = self._run(["babaw", "nya'"], headwords={"babaw nya'": _word("babaw nya'")}, morph_probe=probe)
        assert len(spans) == 1 and spans[0].token_count == 2
        probe.candidates.assert_not_called()

    def test_a_token_the_analyzer_cannot_explain_stays_unsupported(self):
        spans = self._run(["xyzfake"], headwords={"filo": _word("filo")}, morph_probe=_probe())
        assert spans[0].status == "unsupported"

    def test_attested_residue_also_counts_like_the_existing_derived_tier(self):
        # 分析器候選的殘餘是語料詞形（不是詞條）時，沿用既有的 derived 判定：帶 sentence_ref、沒有 lemma id。
        spans = self._run(["mafilo"], attested={"filo": 5}, morph_probe=_probe())
        assert spans[0].status == "derived" and spans[0].lemma == "filo" and spans[0].sentence_ref == 7

    # 直接攔截 logger.info，而不是用 caplog：別的測試（或 dictConfig）可能改過全域日誌設定，
    # 讓 caplog 收不到訊息，這類測試就會只在整個套件一起跑時才失敗。
    def test_shadow_mode_never_changes_the_output_but_records_what_would_have_happened(self):
        probe = _probe(shadow=True)
        with patch.object(morph.logger, "info") as info:
            spans = self._run(["mafilo"], headwords={"filo": _word("filo")}, morph_probe=probe)
        assert spans[0].status == "unsupported" and spans[0].lemma is None
        assert info.call_count == 1
        fmt, *args = info.call_args.args
        rendered = fmt % tuple(args)
        assert "[morph-shadow]" in rendered and "mafilo" in rendered and "filo" in rendered

    def test_shadow_mode_does_not_log_when_the_database_would_not_have_confirmed(self):
        with patch.object(morph.logger, "info") as info:
            self._run(["mafilo"], headwords={}, morph_probe=_probe(shadow=True))
        info.assert_not_called()

    def test_shadow_mode_does_not_log_for_tokens_that_were_already_supported(self):
        sr = lexicon.build_strip_rules([{"affix": "m-", "function": "主事焦點"}])
        hw = {"alaw": _word("alaw"), "law": _word("law")}
        with patch.object(morph.logger, "info") as info:
            spans = self._run(["malaw"], headwords=hw, strip_rules=sr, morph_probe=_probe(shadow=True))
        assert spans[0].status == "derived"
        info.assert_not_called()

    def test_full_sentence_passes_the_probe_through_and_keeps_length(self):
        hw = {"filo": _word("filo")}
        with patch.object(R, "lookup_headwords_batch", side_effect=_lookup_from(hw)), \
             patch.object(R, "lookup_attested_batch", return_value={}):
            spans = R.corroborate_full_sentence(None, _TRIBE_ID, "mafilo, zzz.", morph=_probe())
        assert [s.status for s in spans] == ["derived", "punct", "unsupported", "punct"]

    def test_retrieve_for_tribe_forwards_the_probe(self):
        seen = {}
        def fake_full(db, tribe_id, sentence, strip_rules=None, *, morph=None):
            seen["morph"] = morph
            return []
        with patch.object(R, "corroborate_full_sentence", side_effect=fake_full), \
             patch.object(R, "retrieve_tribe_sentences", return_value=[]):
            R.retrieve_for_tribe(None, _TRIBE_ID, "x", morph="PROBE")
        assert seen["morph"] == "PROBE"


# ---------------------------------------------------------------------------
# MorphProbe
# ---------------------------------------------------------------------------

class TestMorphProbe:
    def test_rejects_a_fuzzy_analyzer(self):
        fuzzy = M.MorphAnalyzer({P_MA: 5}, {"filo"}, precision={P_MA: 0.9}, max_edit=1)
        with pytest.raises(ValueError):
            morph.MorphProbe(fuzzy, {}, "tid", False)

    def test_candidates_are_exact_stage_only_and_carry_a_note(self):
        out = _probe().candidates("mafilo")
        assert [(c.residue, c.note) for c in out] == [("filo", "依形態規則推定：ma-（前綴功能）")]

    def test_note_omits_the_function_when_unknown_instead_of_inventing_one(self):
        out = _probe(functions={}).candidates("mafilo")
        assert out[0].note == "依形態規則推定：ma-"

    def test_unknown_token_has_no_candidates(self):
        assert _probe().candidates("zzzz") == []

    def test_fuzzy_analyses_are_dropped_even_if_an_analyzer_somehow_returns_them(self):
        # 第二道防線：就算分析器（max_edit 宣稱是 0）回傳了模糊結果，探針也不能把它當佐證候選。
        class Stub:
            max_edit = 0
            def analyze(self, token, top_n=3):
                return [M.Analysis("filo", P_MA, 0.9, "fuzzy", 1, 5), M.Analysis("alaw", P_MA, 0.9, "exact", 0, 5)]
        out = morph.MorphProbe(Stub(), {}, "tid", False).candidates("x")
        assert [c.residue for c in out] == ["alaw"]


# ---------------------------------------------------------------------------
# 載入：放行檔驗證與指紋
# ---------------------------------------------------------------------------

class FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def filter(self, *a, **k):
        return self

    def all(self):
        return list(self._rows)


class FakeDb:
    def __init__(self, names, affixes=()):
        self.names, self.affixes = names, list(affixes)

    def query(self, *cols):
        return FakeQuery([(n,) for n in self.names] if len(cols) == 1 else self.affixes)


_HEADWORDS = ["filo", "alaw", "kayal"]


def _artifact(tmp_path, generator=C.GENERATOR_VERSION, **overrides):
    entry = {
        "tribe_id": _TRIBE_ID, "enabled": True, "reason": "",
        "fingerprint": {"headwords_sha256": C.headword_fingerprint(_HEADWORDS)},
        "config": {"min_root_len": 3},
        "rules": [dict(C.rule_to_dict(P_MA), support=20, reliability=0.9)],
        "final_test": {"passed": True, "failed_checks": []},
    }
    entry.update(overrides)
    path = tmp_path / "rules.json"
    path.write_text(json.dumps({"schema": C.SCHEMA_VERSION, "generator": generator,
                                "tribes": {"kavalan": entry}}), encoding="utf-8")
    return path


class TestBuildEntry:
    def _build(self, path, names=None):
        return morph._build_entry(FakeDb(names or _HEADWORDS, [("ma-", "前綴功能")]), _TRIBE_ID, path)

    def test_an_enabled_entry_gets_a_long_expiry_as_insurance_against_lost_invalidations(self, tmp_path):
        before = time.monotonic()
        entry = self._build(_artifact(tmp_path))
        assert before + morph._ENABLED_TTL_SECONDS <= entry.expires_at <= time.monotonic() + morph._ENABLED_TTL_SECONDS
        assert morph._ENABLED_TTL_SECONDS > morph._DISABLED_TTL_SECONDS

    def test_a_disabled_entry_carries_an_expiry_so_it_gets_retried(self, tmp_path):
        assert self._build(_artifact(tmp_path, enabled=False)).expires_at is not None

    @pytest.mark.parametrize("config", [{"min_root_len": 1}, {"min_root_len": True}, {}])
    def test_bad_min_root_len_is_rejected_by_explicit_validation(self, tmp_path, config):
        # 不能只靠分析器建構子丟例外才停用——驗證要明確、原因要說得清楚。
        assert "min_root_len" in self._build(_artifact(tmp_path, config=config)).reason

    def test_valid_artifact_builds_an_enabled_exact_only_analyzer(self, tmp_path):
        entry = self._build(_artifact(tmp_path))
        assert entry.analyzer is not None and entry.analyzer.max_edit == 0 and entry.analyzer.min_root_len == 3
        assert entry.function_table == {"ma-": "前綴功能"}
        assert entry.analyzer.analyze("mafilo")[0].root == "filo"

    def test_lexicon_is_normalized_like_production(self, tmp_path):
        names = ["Filo", "alaw^", "kayal"]
        expected = {lexicon.normalize_token(n) for n in names}
        path = _artifact(tmp_path, fingerprint={"headwords_sha256": C.headword_fingerprint(expected)})
        assert self._build(path, names).analyzer is not None

    def test_fingerprint_mismatch_disables_the_tribe(self, tmp_path):
        # 詞庫換了一個詞、筆數不變——筆數指紋看不出來，內容雜湊必須擋下。
        entry = self._build(_artifact(tmp_path), names=["filo", "alaw", "OTHER"])
        assert entry.analyzer is None and "不一致" in entry.reason

    @pytest.mark.parametrize("override", [
        {"enabled": False, "reason": "未通過"},
        {"enabled": "yes"},
        {"tribe_id": "wrong-id"},
        {"rules": []},
        {"rules": "oops"},
        {"rules": [{"kind": "P", "a": "", "support": 20, "reliability": 0.9}]},
        {"rules": [dict(C.rule_to_dict(P_MA), support=0, reliability=0.9)]},
        {"rules": [dict(C.rule_to_dict(P_MA), support=True, reliability=0.9)]},
        {"rules": [dict(C.rule_to_dict(P_MA), support=20, reliability=1.5)]},
        {"rules": [dict(C.rule_to_dict(P_MA), support=20, reliability=float("nan"))]},
        {"rules": [dict(C.rule_to_dict(P_MA), support=20, reliability="0.9")]},
        {"rules": [dict(C.rule_to_dict(P_MA), support=20, reliability=0.9)] * 2},
        {"config": {"min_root_len": 1}},
        {"config": {"min_root_len": True}},
        {"config": {}},
        {"fingerprint": {}},
        {"fingerprint": {"headwords_sha256": 123}},
    ])
    def test_any_invalid_part_disables_the_tribe_without_raising(self, tmp_path, override):
        entry = self._build(_artifact(tmp_path, **override))
        assert entry.analyzer is None and entry.reason

    @pytest.mark.parametrize("final_test", [
        None, "passed", {}, {"passed": False, "failed_checks": ["x"]},
        {"passed": True, "failed_checks": ["證據不足"]}, {"passed": "yes", "failed_checks": []},
        {"passed": True},
    ])
    def test_enabled_without_a_passed_final_test_record_is_rejected(self, tmp_path, final_test):
        # 手動把 enabled 改成 true 不能繞過最終測試閘門。
        entry = self._build(_artifact(tmp_path, final_test=final_test))
        assert entry.analyzer is None and "最終測試" in entry.reason

    def test_missing_final_test_key_is_rejected(self, tmp_path):
        path = _artifact(tmp_path)
        data = json.loads(path.read_text(encoding="utf-8"))
        del data["tribes"]["kavalan"]["final_test"]
        path.write_text(json.dumps(data), encoding="utf-8")
        assert "最終測試" in self._build(path).reason

    @pytest.mark.parametrize("generator", ["morphology_calibration/1", "", None, "other"])
    def test_artifact_from_another_generator_version_is_rejected(self, tmp_path, generator):
        entry = self._build(_artifact(tmp_path, generator=generator))
        assert entry.analyzer is None and "產生器" in entry.reason

    def test_too_many_rules_is_rejected_even_when_each_one_is_valid_and_distinct(self, tmp_path):
        many = [dict(C.rule_to_dict(MorphRule("P", a=f"p{i}")), support=20, reliability=0.9)
                for i in range(morph._MAX_RULES + 1)]
        assert len({json.dumps(r) for r in many}) == len(many)
        entry = self._build(_artifact(tmp_path, rules=many))
        assert entry.analyzer is None and "數量" in entry.reason
        at_limit = self._build(_artifact(tmp_path, rules=many[:morph._MAX_RULES]))
        assert at_limit.analyzer is not None

    def test_missing_tribe_file_or_garbage_all_disable(self, tmp_path):
        db = FakeDb(_HEADWORDS)
        assert morph._build_entry(db, _TRIBE_ID, tmp_path / "nope.json").analyzer is None
        bad = tmp_path / "bad.json"
        bad.write_text("{not json", encoding="utf-8")
        assert morph._build_entry(db, _TRIBE_ID, bad).analyzer is None
        wrong = tmp_path / "wrong.json"
        wrong.write_text(json.dumps({"schema": 999, "tribes": {}}), encoding="utf-8")
        assert morph._build_entry(db, _TRIBE_ID, wrong).analyzer is None
        other = tmp_path / "other.json"
        other.write_text(json.dumps({"schema": C.SCHEMA_VERSION, "tribes": {"tayal": {}}}), encoding="utf-8")
        assert morph._build_entry(db, _TRIBE_ID, other).analyzer is None

    def test_database_errors_disable_instead_of_raising(self, tmp_path):
        class Boom:
            def query(self, *a):
                raise RuntimeError("db down")
        entry = morph._build_entry(Boom(), _TRIBE_ID, _artifact(tmp_path))
        assert entry.analyzer is None and "db down" in entry.reason

    def test_unknown_tribe_id_disables(self, tmp_path):
        assert morph._build_entry(FakeDb(_HEADWORDS), "no-such-id", _artifact(tmp_path)).analyzer is None


# ---------------------------------------------------------------------------
# 快取：停用狀態也會快取（有存活時間）、失效、探針模式
# ---------------------------------------------------------------------------

class TestCache:
    def setup_method(self):
        morph._CACHE = type(morph._CACHE)()

    def test_entries_are_cached_so_the_artifact_is_not_reloaded_per_request(self):
        good = morph._Entry(_probe()._analyzer, {})
        with patch.object(morph, "_build_entry", return_value=good) as build:
            morph.get_entry(None, _TRIBE_ID)
            morph.get_entry(None, _TRIBE_ID)
        assert build.call_count == 1

    def test_disabled_entries_are_cached_too_to_avoid_hammering_on_failure(self):
        with patch.object(morph, "_build_entry", side_effect=lambda *a: morph._disabled("壞了", log=False)) as build:
            for _ in range(5):
                assert morph.get_entry(None, _TRIBE_ID).analyzer is None
        assert build.call_count == 1

    def test_disabled_entries_are_retried_after_the_ttl(self):
        with patch.object(morph, "_build_entry", side_effect=lambda *a: morph._disabled("壞了", log=False)) as build:
            morph.get_entry(None, _TRIBE_ID)
            future = time.monotonic() + morph._DISABLED_TTL_SECONDS + 1
            with patch.object(morph.time, "monotonic", return_value=future):
                morph.get_entry(None, _TRIBE_ID)
        assert build.call_count == 2

    def test_enabled_entries_are_kept_until_their_long_ttl_then_rebuilt(self):
        start = time.monotonic()
        good = morph._Entry(_probe()._analyzer, {}, "", start + morph._ENABLED_TTL_SECONDS)
        with patch.object(morph, "_build_entry", return_value=good) as build:
            morph.get_entry(None, _TRIBE_ID)
            with patch.object(morph.time, "monotonic", return_value=start + morph._ENABLED_TTL_SECONDS - 1):
                morph.get_entry(None, _TRIBE_ID)
            assert build.call_count == 1
            with patch.object(morph.time, "monotonic", return_value=start + morph._ENABLED_TTL_SECONDS + 1):
                morph.get_entry(None, _TRIBE_ID)
        assert build.call_count == 2

    def test_expiry_check_clear_and_rebuild_are_one_atomic_step(self):
        # 沒有全域鎖時，多個請求會同時讀到「已到期的舊狀態」，各自去清掉再重建，可能把別人剛建好
        # 的新狀態又清掉。這裡讓 invalidate 變慢來放大競態：有鎖時只會有一次清除。
        import threading
        invalidations = []
        real_invalidate = morph._CACHE.invalidate

        def slow_invalidate(key):
            invalidations.append(key)
            time.sleep(0.15)
            return real_invalidate(key)

        morph._CACHE.get_or_compute(_TRIBE_ID, lambda: morph._Entry(None, {}, "old", time.monotonic() - 1))
        fresh = morph._Entry(_probe()._analyzer, {}, "", time.monotonic() + 1000)
        with patch.object(morph._CACHE, "invalidate", side_effect=slow_invalidate),              patch.object(morph, "_build_entry", return_value=fresh):
            threads = [threading.Thread(target=morph.get_entry, args=(None, _TRIBE_ID)) for _ in range(6)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(5)
        assert len(invalidations) == 1

    def test_concurrent_requests_that_find_an_expired_entry_rebuild_it_only_once(self):
        import threading
        calls = []
        gate = threading.Event()

        def slow_build(db, tribe_id):
            calls.append(1)
            gate.wait(1)
            return morph._Entry(_probe()._analyzer, {}, "", time.monotonic() + 1000)

        morph._CACHE.get_or_compute(_TRIBE_ID, lambda: morph._Entry(None, {}, "old", time.monotonic() - 1))
        with patch.object(morph, "_build_entry", side_effect=slow_build):
            threads = [threading.Thread(target=morph.get_entry, args=(None, _TRIBE_ID)) for _ in range(8)]
            for t in threads:
                t.start()
            time.sleep(0.2)
            gate.set()
            for t in threads:
                t.join(5)
        assert len(calls) == 1

    def test_invalidate_forces_a_rebuild_for_one_tribe_or_all(self):
        good = morph._Entry(_probe()._analyzer, {})
        with patch.object(morph, "_build_entry", return_value=good) as build:
            morph.get_entry(None, _TRIBE_ID)
            morph.invalidate(_TRIBE_ID)
            morph.get_entry(None, _TRIBE_ID)
            morph.invalidate()
            morph.get_entry(None, _TRIBE_ID)
        assert build.call_count == 3

    def test_probe_for_apply_vs_shadow_vs_disabled(self):
        good = morph._Entry(_probe()._analyzer, {})
        with patch.object(morph, "get_entry", return_value=good):
            assert morph.probe_for(None, _TRIBE_ID, apply_enabled=True).shadow is False
            assert morph.probe_for(None, _TRIBE_ID, apply_enabled=False).shadow is True
        with patch.object(morph, "get_entry", return_value=morph._disabled("x", log=False)):
            assert morph.probe_for(None, _TRIBE_ID, apply_enabled=True) is None


# ---------------------------------------------------------------------------
# service：旗標與請求層級行為
# ---------------------------------------------------------------------------

class TestResolveMorph:
    def test_flags_default_to_off_and_nothing_is_loaded_when_both_are_off(self):
        calls = []

        def fake_enabled(key, default=True):
            calls.append((key, default))
            return default

        with patch.object(S.feature_flags, "is_enabled", side_effect=fake_enabled), \
             patch.object(S.MORPH, "probe_for") as probe_for:
            assert S._resolve_morph(None, _TRIBE_ID) is None
        probe_for.assert_not_called()
        # 兩個旗標都明確以 default=False 查詢（fail-closed），不能依賴函式本身的預設值 True。
        assert sorted(calls) == [(morph.FLAG_APPLY, False), (morph.FLAG_SHADOW, False)]

    @pytest.mark.parametrize("apply_on,shadow_on,expect_apply", [(True, False, True), (False, True, False), (True, True, True)])
    def test_flag_combinations(self, apply_on, shadow_on, expect_apply):
        flags = {morph.FLAG_APPLY: apply_on, morph.FLAG_SHADOW: shadow_on}
        with patch.object(S.feature_flags, "is_enabled", side_effect=lambda k, default=True: flags[k]), \
             patch.object(S.MORPH, "probe_for", return_value="PROBE") as probe_for:
            assert S._resolve_morph(None, _TRIBE_ID) == "PROBE"
        assert probe_for.call_args.kwargs == {"apply_enabled": expect_apply}

    def test_any_error_is_swallowed_and_translation_proceeds_without_the_analyzer(self):
        with patch.object(S.feature_flags, "is_enabled", return_value=True), \
             patch.object(S.MORPH, "probe_for", side_effect=RuntimeError("boom")):
            assert S._resolve_morph(None, _TRIBE_ID) is None

    def test_translate_resolves_the_flags_once_per_request_and_passes_the_probe_down(self):
        sentinel = object()
        with patch.object(S, "_resolve_morph", return_value=sentinel) as resolve, \
             patch.object(S, "_translate_zh2tribe") as zh2tribe, patch.object(S, "_translate_tribe2zh") as tribe2zh:
            S.translate(None, "kavalan", "zh2tribe", "你好")
            S.translate(None, "kavalan", "tribe2zh", "kayal")
        assert resolve.call_count == 2
        assert zh2tribe.call_args.kwargs["morph"] is sentinel and tribe2zh.call_args.kwargs["morph"] is sentinel

    def test_with_flags_off_translate_calls_internals_with_morph_none(self):
        with patch.object(S.feature_flags, "is_enabled", side_effect=lambda k, default=True: default), \
             patch.object(S, "_translate_zh2tribe") as zh2tribe:
            S.translate(None, "kavalan", "zh2tribe", "你好")
        assert zh2tribe.call_args.kwargs["morph"] is None

    def test_corroborate_sentence_forwards_the_probe(self):
        with patch.object(S, "_get_strip_rules", return_value=None), \
             patch.object(S.R, "corroborate_full_sentence", return_value=[]) as full:
            S._corroborate_sentence(None, "tid", "x", morph="PROBE")
        assert full.call_args.kwargs["morph"] == "PROBE"


class TestTheShippedArtifact:
    """repo 裡實際提交的放行檔本身的健全性檢查（不連資料庫）。"""

    def _artifact(self):
        return json.loads(morph.ARTIFACT_PATH.read_text(encoding="utf-8"))

    def test_has_the_expected_schema_and_covers_every_tribe(self):
        art = self._artifact()
        assert art["schema"] == C.SCHEMA_VERSION
        assert set(art["tribes"]) == {t.slug for t in TRIBES}

    def test_tribe_ids_match_the_application_constants(self):
        for t in TRIBES:
            assert self._artifact()["tribes"][t.slug]["tribe_id"] == t.id

    def test_every_enabled_tribe_passed_the_final_gate_and_has_valid_rules(self):
        for slug, entry in self._artifact()["tribes"].items():
            if not entry["enabled"]:
                assert entry["rules"] == [] and entry["reason"]
                continue
            assert entry["final_test"]["passed"] is True
            support, reliability = morph._parse_rules(entry)
            assert support and all(0 <= r <= 1 for r in reliability.values())
            assert entry["config"]["min_root_len"] >= 3
            assert len(entry["fingerprint"]["headwords_sha256"]) == 64

    def test_generator_matches_the_current_version(self):
        assert self._artifact()["generator"] == C.GENERATOR_VERSION

    def test_every_enabled_tribe_final_numbers_satisfy_the_documented_policy_upper_bounds(self):
        cfg = C.AdmissionConfig()
        for slug, entry in self._artifact()["tribes"].items():
            if not entry["enabled"]:
                continue
            ft = entry["final_test"]
            assert ft["accepted"] >= C.MIN_FINAL_ACCEPTED
            assert C.wilson_upper(ft["wrong_root"], ft["accepted"]) <= cfg.max_wrong_root_rate
            for fam, limit in cfg.union_targets.items():
                v = ft["fa"][fam]
                assert v["n"] >= C.MIN_FINAL_NEGATIVES
                assert C.wilson_upper(v["accepted"], v["n"]) <= limit, (slug, fam)

    def test_the_file_uses_lf_line_endings_like_the_rest_of_the_repo(self):
        assert b"\r" not in morph.ARTIFACT_PATH.read_bytes()
