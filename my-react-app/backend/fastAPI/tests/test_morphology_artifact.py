"""config/morphology_artifact.py：放行檔載入判斷（執行期與報表共用）。載入行為本身由 test_translation_morph.py 鎖住。"""
import json

import pytest

from config import morphology_artifact as A
from config import morphology_calibration as C
from config.tribes import TRIBES

KAV = next(t for t in TRIBES if t.slug == "kavalan")
FP = "abc"


def _write(tmp_path, **entry_overrides):
    entry = {
        "tribe_id": KAV.id, "enabled": True, "reason": "",
        "fingerprint": {"headwords_sha256": FP},
        "config": {"min_root_len": 3},
        "rules": [{"kind": "P", "a": "ma", "support": 20, "reliability": 0.9}],
        "final_test": {"passed": True, "failed_checks": []},
    }
    entry.update(entry_overrides)
    p = tmp_path / "r.json"
    p.write_text(json.dumps({"schema": C.SCHEMA_VERSION, "generator": C.GENERATOR_VERSION, "tribes": {"kavalan": entry}}), encoding="utf-8")
    return p


def _assess(p, fp=FP, calls=None):
    def current():
        if calls is not None:
            calls.append(1)
        return fp
    return A.assess_artifact_entry(p, "kavalan", KAV.id, current)


def test_valid_entry_is_ok(tmp_path):
    r = _assess(_write(tmp_path))
    assert r.ok and r.min_root_len == 3 and len(r.support) == 1


def test_fingerprint_is_only_computed_after_all_other_checks_pass(tmp_path):
    calls = []
    assert not _assess(_write(tmp_path, enabled=False), calls=calls).ok
    assert not _assess(_write(tmp_path, final_test={"passed": False, "failed_checks": []}), calls=calls).ok
    assert calls == []
    assert _assess(_write(tmp_path), calls=calls).ok and calls == [1]


def test_disabled_entry_is_not_logged_but_other_failures_are(tmp_path):
    assert _assess(_write(tmp_path, enabled=False)).log is False
    assert _assess(_write(tmp_path, final_test=None)).log is True


@pytest.mark.parametrize("override", [
    {"final_test": {"passed": True, "failed_checks": ["x"]}},
    {"final_test": {"passed": 1, "failed_checks": []}},
    {"rules": []},
    {"config": {"min_root_len": True}},
    {"fingerprint": {}},
    {"tribe_id": "other"},
])
def test_invalid_entries_are_refused(tmp_path, override):
    assert not _assess(_write(tmp_path, **override)).ok


def test_stale_fingerprint_is_refused(tmp_path):
    assert "不一致" in _assess(_write(tmp_path), fp="different").reason


def test_never_raises_on_garbage(tmp_path):
    bad = tmp_path / "x.json"
    bad.write_text("[]", encoding="utf-8")
    assert not _assess(bad).ok
    assert not _assess(tmp_path / "missing.json").ok


def test_a_failing_fingerprint_function_becomes_a_reason(tmp_path):
    def boom():
        raise RuntimeError("db down")
    r = A.assess_artifact_entry(_write(tmp_path), "kavalan", KAV.id, boom)
    assert not r.ok and "RuntimeError" in r.reason
