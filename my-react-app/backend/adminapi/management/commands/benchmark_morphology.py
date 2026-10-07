"""M8 形態分析基準：在凍結的最終測試切分 final-v1 上，重新評估放行檔的規則並逐筆分析失敗（唯讀）。

  python manage.py benchmark_morphology                       # 各族表格
  python manage.py benchmark_morphology --format json         # 機器可讀；同樣資料重跑逐位元組相同
  python manage.py benchmark_morphology --tribe amis --max-items 50
  python manage.py benchmark_morphology --format json --output bench.json    # 原子寫入

這是「重現／回歸檢查」，不是新的獨立測試：final-v1 已經在校準時被用掉一次（見 config/morphology_benchmark.py
的生命週期說明）。只查辭典、讀放行檔；不改資料庫、不改放行檔、不影響執行期。
"""
import json
import re
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from adminapi.management.commands.report_morphology_capabilities import write_atomic
from adminapi.morphology_inputs import load_tribe_inputs
from config import morphology_artifact as artifact
from config import morphology_benchmark as B
from config import morphology_calibration as C
from config.tribes import TRIBES
from dictionary_db.connect import SessionLocal
from fastAPI.routes.translation.morph import ARTIFACT_PATH


MAX_ITEMS_LIMIT = 500   # 失敗清單每類的硬上限：failure_analysis 等於標註資料的匯出，不開放無限量


def _clean_text(value, limit: int = 200) -> str:
    """放行檔裡的自由文字（reason）只取第一行、去掉控制字元、截斷：不讓不可信內容把報表版面或機器可讀欄位搞亂。"""
    if not isinstance(value, str):
        return ""
    first = value.splitlines()[0] if value else ""
    return re.sub(r"[\x00-\x1f\x7f]", "", first)[:limit]


def _cfg_from_entry(entry: dict) -> C.AdmissionConfig:
    cfg = entry.get("config")
    if not isinstance(cfg, dict):
        raise ValueError("config 缺少")
    seed, min_root_len = cfg.get("seed"), cfg.get("min_root_len")
    if isinstance(seed, bool) or not isinstance(seed, int) or isinstance(min_root_len, bool) or not isinstance(min_root_len, int):
        raise ValueError("config 的 seed／min_root_len 不合法")
    return C.AdmissionConfig(seed=seed, min_root_len=min_root_len)


def benchmark_tribe(inputs, entry, max_items: int, loadable: bool | None = None) -> dict:
    """一個族語的基準結果。永遠不丟例外：放行檔缺資料、壞掉都轉成 status 與原因（只有例外種類，不含路徑）。"""
    pairs, _ = inputs.build_pairs()
    test = B.split_pairs(pairs)
    base = {
        "tribe": inputs.tribe.slug, "test_pairs": len(test), "split_sha256": B.split_fingerprint(test),
        "attested_sha256": C.attested_fingerprint(inputs.attested),
        "status": "", "reason": "", "artifact_fingerprints_match": None, "runtime_rebuild_loadable": None,
        "recorded_counts_match": None, "recorded_diffs": None, "result": None,
    }
    if not isinstance(entry, dict):
        return {**base, "status": "artifact_unavailable", "reason": "放行檔沒有這一族的資料"}
    fp = entry.get("fingerprint") if isinstance(entry.get("fingerprint"), dict) else {}
    # 只比放行檔記錄的兩種指紋（詞庫、配對）。語料詞形（attested）不在放行檔裡，無從比對，但它會改變負例，
    # 所以這個欄位叫 artifact_fingerprints_match 而不是「輸入最新」；attested_sha256 另列供人工比對。
    base["artifact_fingerprints_match"] = (fp.get("headwords_sha256") == C.headword_fingerprint(inputs.lexicon_set)
                                           and fp.get("pairs_sha256") == C.pairs_fingerprint(pairs))
    base["runtime_rebuild_loadable"] = loadable
    if entry.get("tribe_id") != inputs.tribe.id:
        return {**base, "status": "artifact_invalid", "reason": "tribe_id 與這個族語不符"}
    rules = entry.get("rules")
    if isinstance(rules, list) and not rules:
        if entry.get("enabled") is not False:
            return {**base, "status": "artifact_invalid", "reason": "沒有規則卻不是停用狀態"}
        return {**base, "status": "no_admitted_rules", "reason": _clean_text(entry.get("reason")) or "放行檔沒有任何放行規則"}
    if entry.get("enabled") is not True:
        return {**base, "status": "artifact_invalid", "reason": "有規則但 enabled 不是 true"}
    try:
        _, reliability = artifact.parse_rules(entry)
        cfg = _cfg_from_entry(entry)
        result = B.evaluate_split(pairs, inputs.lexicon_set, inputs.attested, reliability, cfg, max_items)
    except Exception as exc:
        return {**base, "status": "artifact_invalid", "reason": f"{type(exc).__name__}"}
    diffs = B.compare_with_recorded(result, entry.get("final_test"))
    return {**base, "status": "evaluated", "result": result, "recorded_diffs": diffs,
            "recorded_counts_match": None if diffs is None else diffs == []}


def build(db, artifact_path: Path, slugs=None, max_items: int = 20) -> dict:
    data = None
    try:
        data = artifact.read_artifact(artifact_path)
        tribes_in_artifact, error, generator = data["tribes"], None, data.get("generator")
    except Exception as exc:
        tribes_in_artifact, error, generator = {}, type(exc).__name__, None   # 只記種類，不含路徑
    targets = [t for t in TRIBES if slugs is None or t.slug in slugs]

    def one(tribe):
        inputs = load_tribe_inputs(db, tribe)
        # 與報表、執行期同一份載入判斷（放行檔只讀這一次）：基準在不能載入的放行檔上算出的數字不代表線上行為
        loadable = None if data is None else artifact.assess_loaded_artifact(
            data, tribe.slug, tribe.id, lambda: C.headword_fingerprint(inputs.lexicon_set)).ok
        return benchmark_tribe(inputs, tribes_in_artifact.get(tribe.slug), max_items, loadable)
    return {
        "benchmark_version": B.BENCHMARK_VERSION,
        "split": B.SPLIT_DESCRIPTOR,
        "artifact_generator": generator, "artifact_error": error, "max_items": max_items,
        "tribes": [one(t) for t in targets],
    }


def _pct(m) -> str:
    return "—" if m is None or m["value"] is None else f"{m['value']:.1%}（{m['lo']:.1%}–{m['hi']:.1%}）"


STATUS_LABELS = {"evaluated": "已評估", "no_admitted_rules": "無放行規則", "artifact_invalid": "放行檔異常",
                 "artifact_unavailable": "放行檔無資料"}


def render_table(report: dict) -> str:
    s = report["split"]
    lines = [f"切分 {s['version']}（{s['rule']}）｜狀態：{s['lifecycle']['state']}｜{s['lifecycle']['role']}",
             f"注意：{s['lifecycle']['policy']}",
             f"放行檔產生器：{report['artifact_generator']}" + (f"　讀取失敗：{report['artifact_error']}" if report["artifact_error"] else "")]
    for t in report["tribes"]:
        head = f"{t['tribe']:8s} {STATUS_LABELS.get(t['status'], t['status'])}｜測試配對 {t['test_pairs']}"
        if t["artifact_fingerprints_match"] is False:
            head += "｜辭典與放行檔指紋不一致（舊資料快照）"
        if t["runtime_rebuild_loadable"] is False:
            head += "｜放行檔現在無法載入"
        if t["recorded_counts_match"] is not None:
            head += "｜重算計數與放行檔記錄" + ("相同" if t["recorded_counts_match"] else "不同：" + "、".join(t["recorded_diffs"]))
        lines.append(head)
        if t["reason"]:
            lines.append(f"         原因：{t['reason']}")
        r = t["result"]
        if r:
            m = r["metrics"]
            lines.append(f"         放行率 {_pct(m['release_rate'])}｜精確率 {_pct(m['precision'])}｜錯詞根率 {_pct(m['wrong_root_rate'])}")
            lines.append("         錯放行 " + "｜".join(f"{f} {_pct(v)}" for f, v in m["false_accept"].items()))
            miss = r["failure_analysis"]["real_words"]["missed"]
            lines.append(f"         未放行真詞：{r['real_evaluated'] - r['accepted']}（"
                         + "、".join(f"{k} {v}" for k, v in miss.items()) + f"）｜錯詞根 {r['wrong_root']}")
    return "\n".join(lines)


def render(report: dict, fmt: str) -> str:
    if fmt == "json":
        return json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    return render_table(report) + "\n"


class Command(BaseCommand):
    help = "M8：在凍結切分 final-v1 上重新評估放行檔規則並分析失敗（唯讀；重現檢查，非新的獨立測試）。"

    def add_arguments(self, parser):
        parser.add_argument("--format", choices=["table", "json"], default="table")
        parser.add_argument("--tribe", action="append", default=None, help="只評估這個族語（slug，可重複）")
        parser.add_argument("--max-items", type=int, default=20,
                            help=f"失敗清單每類最多列出幾筆（0～{MAX_ITEMS_LIMIT}；計數永遠完整）")
        parser.add_argument("--output", default=None, help="寫到這個檔案（原子寫入）；省略則印到標準輸出")
        parser.add_argument("--artifact", default=None, help="放行檔路徑（預設為執行期使用的那份）")

    def handle(self, *args, **opts):
        known = {t.slug for t in TRIBES}
        slugs = set(opts["tribe"]) if opts["tribe"] else None
        if slugs and slugs - known:
            raise CommandError(f"未知的族語：{', '.join(sorted(slugs - known))}")
        if not 0 <= opts["max_items"] <= MAX_ITEMS_LIMIT:
            raise CommandError(f"--max-items 必須介於 0 到 {MAX_ITEMS_LIMIT}")
        path = Path(opts["artifact"]) if opts["artifact"] else ARTIFACT_PATH
        db = SessionLocal()
        try:
            report = build(db, path, slugs, opts["max_items"])
        except Exception as exc:
            raise CommandError(f"產生基準失敗：{type(exc).__name__}")
        finally:
            db.close()
        text = render(report, opts["format"])
        if opts["output"]:
            out = Path(opts["output"])
            if not out.parent.is_dir():
                raise CommandError("輸出資料夾不存在")
            try:
                write_atomic(out, text)
            except OSError as exc:
                raise CommandError(f"寫入失敗：{type(exc).__name__}")
            self.stdout.write(f"已寫入 {out.name}（{len(text)} 字元）")
        else:
            self.stdout.write(text, ending="")
