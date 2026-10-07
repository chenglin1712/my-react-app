"""benchmark_morphology 指令：狀態、與放行檔記錄的比對、決定性、唯讀、錯誤處理。
基準的計算本身（與 C.final_report 交叉驗證）在 fastAPI/tests/test_morphology_benchmark.py。"""
import io
import json
import random
import tempfile
from pathlib import Path
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase

from adminapi.management.commands import benchmark_morphology as cmd
from adminapi.morphology_inputs import TribeInputs
from config import morphology as M
from config import morphology_calibration as C
from config.morphology import MorphRule
from config.tribes import TRIBES

KAV = next(t for t in TRIBES if t.slug == "kavalan")
AMIS = next(t for t in TRIBES if t.slug == "amis")
P_MA = MorphRule("P", a="ma")
BENCH = "adminapi.management.commands.benchmark_morphology"


def _inputs(tribe=KAV, n=500, seed=7):
    rng = random.Random(seed)
    letters = "abdgiklmnpqrstuwy"
    roots, seen = [], set()
    while len(roots) < n:
        r = "".join(rng.choice(letters) for _ in range(rng.randint(4, 7)))
        if r not in seen:
            seen.add(r)
            roots.append(r)
    prefixed = [(("ma" if i % 2 == 0 else "pa") + r, r) for i, r in enumerate(roots)]
    rows = tuple((tribe.full_name, d, r) for d, r in prefixed)
    lexicon = frozenset(set(roots) | {d for d, _ in prefixed})
    return TribeInputs(tribe, len(rows), lexicon, rows, frozenset(), ())


def _entry(inputs, **overrides):
    pairs, _ = inputs.build_pairs()
    cfg = C.AdmissionConfig()
    final = C.final_report({P_MA: {"reliability": 0.95}}, pairs, inputs.lexicon_set, inputs.attested, cfg)
    entry = {
        "tribe_id": inputs.tribe.id, "enabled": True, "reason": "",
        "fingerprint": {"headwords_sha256": C.headword_fingerprint(inputs.lexicon_set),
                        "pairs_sha256": C.pairs_fingerprint(pairs)},
        "config": {"seed": cfg.seed, "min_root_len": cfg.min_root_len},
        "rules": [dict(C.rule_to_dict(P_MA), support=100, reliability=0.95)],
        "final_test": final,
    }
    entry.update(overrides)
    return entry


class BenchmarkTribeTests(SimpleTestCase):
    def test_a_fresh_entry_is_evaluated_and_reproduces_the_recorded_final_test(self):
        inputs = _inputs()
        out = cmd.benchmark_tribe(inputs, _entry(inputs), 5)
        self.assertEqual((out["status"], out["artifact_fingerprints_match"], out["recorded_counts_match"], out["recorded_diffs"]),
                         ("evaluated", True, True, []))
        self.assertEqual(len(out["attested_sha256"]), 64)
        self.assertGreater(out["result"]["accepted"], 20)
        self.assertEqual(out["test_pairs"], out["result"]["test_pairs"])

    def test_a_tampered_record_is_reported_as_a_named_difference(self):
        inputs = _inputs()
        entry = _entry(inputs)
        entry["final_test"]["accepted"] += 1
        out = cmd.benchmark_tribe(inputs, entry, 5)
        self.assertEqual((out["recorded_counts_match"], out["recorded_diffs"]), (False, ["accepted"]))

    def test_changed_dictionary_marks_inputs_stale_and_usually_stops_matching(self):
        inputs = _inputs()
        entry = _entry(inputs)
        changed = TribeInputs(inputs.tribe, inputs.word_row_count, inputs.lexicon_set | {"newword"},
                              inputs.pair_rows, inputs.attested, ())
        out = cmd.benchmark_tribe(changed, entry, 5)
        self.assertFalse(out["artifact_fingerprints_match"])
        self.assertEqual(out["status"], "evaluated")

    def test_attested_forms_are_not_in_the_artifact_so_only_their_fingerprint_is_reported(self):
        inputs = _inputs()
        entry = _entry(inputs)
        changed = TribeInputs(inputs.tribe, inputs.word_row_count, inputs.lexicon_set, inputs.pair_rows,
                              frozenset({"somesurface"}), ())
        a, b = cmd.benchmark_tribe(inputs, entry, 5), cmd.benchmark_tribe(changed, entry, 5)
        self.assertTrue(b["artifact_fingerprints_match"])             # 放行檔記錄的兩種指紋看不出語料詞形變了
        self.assertNotEqual(a["attested_sha256"], b["attested_sha256"])   # 但報表有另列，供人工比對

    def test_inconsistent_artifact_entries_are_invalid_not_evaluated(self):
        inputs = _inputs()
        cases = {
            "tribe_id 與這個族語不符": _entry(inputs, tribe_id="someone-else"),
            "有規則但 enabled 不是 true": _entry(inputs, enabled=False),
            "沒有規則卻不是停用狀態": _entry(inputs, rules=[], enabled=True),
        }
        for reason, entry in cases.items():
            out = cmd.benchmark_tribe(inputs, entry, 5)
            self.assertEqual((out["status"], out["reason"], out["result"]), ("artifact_invalid", reason, None))

    def test_free_text_reason_is_sanitized(self):
        inputs = _inputs()
        nasty = "第一行\x07\x1b[31m紅\nsecond line C:\\secret\\path" + "x" * 500
        out = cmd.benchmark_tribe(inputs, _entry(inputs, enabled=False, rules=[], final_test=None, reason=nasty), 5)
        self.assertEqual(out["status"], "no_admitted_rules")
        self.assertNotIn("\n", out["reason"])
        self.assertNotIn("second line", out["reason"])
        self.assertNotIn("\x07", out["reason"])
        self.assertLessEqual(len(out["reason"]), 200)
        long_line = cmd.benchmark_tribe(inputs, _entry(inputs, enabled=False, rules=[], final_test=None, reason="y" * 900), 5)
        self.assertEqual(len(long_line["reason"]), 200)                  # 單行的超長文字也要截斷
        self.assertEqual(cmd.benchmark_tribe(inputs, _entry(inputs, enabled=False, rules=[], final_test=None, reason=123), 5)["reason"],
                         "放行檔沒有任何放行規則")

    def test_loadable_flag_is_passed_through_for_the_report(self):
        inputs = _inputs()
        self.assertIs(cmd.benchmark_tribe(inputs, _entry(inputs), 5, loadable=False)["runtime_rebuild_loadable"], False)
        self.assertIsNone(cmd.benchmark_tribe(inputs, _entry(inputs), 5)["runtime_rebuild_loadable"])

    def test_no_rules_is_not_an_error_and_still_reports_the_split(self):
        inputs = _inputs()
        out = cmd.benchmark_tribe(inputs, _entry(inputs, enabled=False, rules=[], final_test=None, reason="資料不足"), 5)
        self.assertEqual((out["status"], out["reason"], out["result"]), ("no_admitted_rules", "資料不足", None))
        self.assertGreater(out["test_pairs"], 0)
        self.assertEqual(len(out["split_sha256"]), 64)

    def test_missing_entry_and_broken_entries_never_raise(self):
        inputs = _inputs()
        self.assertEqual(cmd.benchmark_tribe(inputs, None, 5)["status"], "artifact_unavailable")
        for broken in (_entry(inputs, rules="x"), _entry(inputs, config=None), _entry(inputs, config={"seed": True, "min_root_len": 3}),
                       _entry(inputs, rules=[{"kind": "Z"}])):
            out = cmd.benchmark_tribe(inputs, broken, 5)
            self.assertEqual(out["status"], "artifact_invalid", broken.get("config"))
            self.assertNotIn("/", out["reason"])                 # 只有例外種類，沒有路徑或訊息

    def test_entry_without_a_recorded_final_test_has_no_comparison(self):
        inputs = _inputs()
        out = cmd.benchmark_tribe(inputs, _entry(inputs, final_test=None), 5)
        self.assertEqual((out["status"], out["recorded_counts_match"], out["recorded_diffs"]), ("evaluated", None, None))


class BenchmarkCommandTests(SimpleTestCase):
    def _artifact(self, tmp, inputs, **entry_kw):
        path = Path(tmp) / "rules.json"
        path.write_text(json.dumps({
            "schema": C.SCHEMA_VERSION, "generator": C.GENERATOR_VERSION,
            "tribes": {"kavalan": _entry(inputs, **entry_kw)},
        }), encoding="utf-8")
        return path

    def _run(self, inputs, path, *args):
        buf = io.StringIO()
        by_slug = {"kavalan": inputs}

        def fake_load(db, tribe):
            return by_slug.get(tribe.slug) or TribeInputs(tribe, 0, frozenset(), (), frozenset(), ())
        with mock.patch(f"{BENCH}.SessionLocal", return_value=mock.MagicMock()), \
                mock.patch(f"{BENCH}.load_tribe_inputs", side_effect=fake_load):
            call_command("benchmark_morphology", "--artifact", str(path), *args, stdout=buf)
        return buf.getvalue()

    def test_json_is_deterministic_and_lists_all_tribes_in_fixed_order(self):
        inputs = _inputs()
        with tempfile.TemporaryDirectory() as tmp:
            path = self._artifact(tmp, inputs)
            first = self._run(inputs, path, "--format", "json")
            self.assertEqual(first, self._run(inputs, path, "--format", "json"))
        data = json.loads(first)
        self.assertEqual([t["tribe"] for t in data["tribes"]], [t.slug for t in TRIBES])
        self.assertEqual(data["split"]["version"], "final-v1")
        self.assertEqual(data["split"]["lifecycle"]["state"], "consumed")
        self.assertEqual(next(t for t in data["tribes"] if t["tribe"] == "amis")["status"], "artifact_unavailable")

    def test_table_mentions_split_lifecycle_and_match_status(self):
        inputs = _inputs()
        with tempfile.TemporaryDirectory() as tmp:
            text = self._run(inputs, self._artifact(tmp, inputs))
        self.assertIn("final-v1", text)
        self.assertIn("consumed", text)
        self.assertIn("不得依本基準的失敗分析調整規則", text)            # 政策也要出現在人看的表格裡
        self.assertIn("重算計數與放行檔記錄相同", text)

    def test_tribe_filter_and_unknown_tribe(self):
        inputs = _inputs()
        with tempfile.TemporaryDirectory() as tmp:
            path = self._artifact(tmp, inputs)
            data = json.loads(self._run(inputs, path, "--format", "json", "--tribe", "kavalan"))
            self.assertEqual([t["tribe"] for t in data["tribes"]], ["kavalan"])
            with self.assertRaises(CommandError):
                self._run(inputs, path, "--tribe", "klingon")
            for bad in ("-1", str(cmd.MAX_ITEMS_LIMIT + 1)):
                with self.assertRaises(CommandError):
                    self._run(inputs, path, "--max-items", bad)
            self._run(inputs, path, "--max-items", str(cmd.MAX_ITEMS_LIMIT))   # 上限本身可用

    def test_max_items_limits_lists_only(self):
        inputs = _inputs(n=800)
        with tempfile.TemporaryDirectory() as tmp:
            path = self._artifact(tmp, inputs)
            small = json.loads(self._run(inputs, path, "--format", "json", "--max-items", "1"))
            large = json.loads(self._run(inputs, path, "--format", "json", "--max-items", "500"))
        a = next(t for t in small["tribes"] if t["tribe"] == "kavalan")["result"]
        b = next(t for t in large["tribes"] if t["tribe"] == "kavalan")["result"]
        self.assertEqual(a["failure_analysis"]["real_words"], b["failure_analysis"]["real_words"])
        self.assertEqual(a["fa"], b["fa"])
        self.assertGreater(b["failure_analysis"]["real_words"]["missed"]["rule_not_admitted"], 5)
        self.assertEqual(len(a["failure_analysis"]["missed_items"]["rule_not_admitted"]), 1)
        self.assertGreater(len(b["failure_analysis"]["missed_items"]["rule_not_admitted"]), 5)

    def test_loadable_comes_from_the_shared_runtime_check_with_one_artifact_read(self):
        # 放行檔 generator 過期：執行期不會載入，基準要把它標出來（數字仍會算，但不代表線上行為）
        inputs = _inputs()
        with tempfile.TemporaryDirectory() as tmp:
            path = self._artifact(tmp, inputs)
            data = json.loads(path.read_text(encoding="utf-8"))
            data["generator"] = "old/1"
            path.write_text(json.dumps(data), encoding="utf-8")
            result = json.loads(self._run(inputs, path, "--format", "json", "--tribe", "kavalan"))
        kav = result["tribes"][0]
        self.assertIs(kav["runtime_rebuild_loadable"], False)
        self.assertEqual(kav["status"], "evaluated")

    def test_unreadable_artifact_is_reported_without_the_path(self):
        inputs = _inputs()
        with tempfile.TemporaryDirectory() as tmp:
            data = json.loads(self._run(inputs, Path(tmp) / "secret-name.json", "--format", "json"))
        self.assertEqual(data["artifact_error"], "FileNotFoundError")
        self.assertNotIn("secret-name", json.dumps(data))
        self.assertTrue(all(t["status"] == "artifact_unavailable" for t in data["tribes"]))

    def test_output_is_atomic_and_the_artifact_is_never_modified(self):
        inputs = _inputs()
        with tempfile.TemporaryDirectory() as tmp:
            path = self._artifact(tmp, inputs)
            before = path.read_bytes()
            out = Path(tmp) / "bench.json"
            self._run(inputs, path, "--format", "json", "--output", str(out))
            self.assertEqual(json.loads(out.read_text(encoding="utf-8"))["benchmark_version"], 1)
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ["bench.json", "rules.json"])
            with self.assertRaises(CommandError):
                self._run(inputs, path, "--output", str(Path(tmp) / "nope" / "b.json"))

    def test_failed_write_keeps_old_output_and_leaves_no_temp_file(self):
        inputs = _inputs()
        with tempfile.TemporaryDirectory() as tmp:
            path = self._artifact(tmp, inputs)
            out = Path(tmp) / "bench.json"
            out.write_text("old", encoding="utf-8")
            with mock.patch("os.replace", side_effect=OSError("boom")):
                with self.assertRaises(CommandError):
                    self._run(inputs, path, "--format", "json", "--output", str(out))
            self.assertEqual(out.read_text(encoding="utf-8"), "old")
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ["bench.json", "rules.json"])
