"""唯讀：各族語形態分析目前的「能力報表」——放行率、精確率、錯放行率（皆附 Wilson 95% 區間）與四層狀態。

  python manage.py report_morphology_capabilities                  # 表格
  python manage.py report_morphology_capabilities --format json    # 固定順序、同資料逐位元組相同
  python manage.py report_morphology_capabilities --format csv
  python manage.py report_morphology_capabilities --format json --output report.json   # 原子寫入（先寫暫存檔再改名）

只查辭典、讀放行檔；不改資料庫、不改放行檔、不影響執行期。數字定義與狀態層級見 config/morphology_reporting.py。
"""
import csv
import io
import json
import os
import tempfile
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from adminapi.management.commands.report_morphology_inputs import collect_with_artifact
from config import morphology_calibration as C
from config import morphology_reporting as R
from dictionary_db.connect import SessionLocal
from fastAPI.routes.translation.morph import ARTIFACT_PATH


def build(db, artifact_path: Path) -> dict:
    inputs_report, tribes = collect_with_artifact(db, artifact_path)
    return R.build_report(inputs_report, tribes)


def _pct(m) -> str:
    return "—" if m is None or m["value"] is None else f"{m['value']:.1%}（{m['lo']:.1%}–{m['hi']:.1%}）"


def render_table(report: dict) -> str:
    lines = [f"放行檔產生器：{report['artifact_generator']}" + (f"　讀取失敗：{report['artifact_error']}" if report["artifact_error"] else "")]
    for t in report["tribes"]:
        L = t["layers"]
        head = (f"{t['tribe']:8s} 輸入 {L['input_freshness']}｜完整性 {L['artifact_integrity']}"
                f"｜可重建載入 {'是' if L['runtime_rebuild_loadable'] else '否'}｜閘門 {L['gate']}")
        lines.append(head + ("｜舊資料快照" if t["snapshot_stale"] else ""))
        m = t["metrics"]
        if m:
            lines.append(f"         放行率 {_pct(m['release_rate'])}｜精確率 {_pct(m['precision'])}｜錯詞根率 {_pct(m['wrong_root_rate'])}")
            lines.append("         錯放行 " + "｜".join(f"{f} {_pct(v)}" for f, v in m["false_accept"].items()))
        for p in t["problems"]:
            lines.append(f"         問題：{p}")
    return "\n".join(lines)


_CSV_RATIOS = ("release_rate", "precision", "wrong_root_rate") + tuple(f"false_accept_{f}" for f in C.FAMILIES)
_CSV_PARTS = ("k", "n", "value", "lo", "hi")


def _csv_ratio(m, name: str):
    if name.startswith("false_accept_"):
        return m["false_accept"][name[len("false_accept_"):]]
    return m[name]


def render_csv(report: dict) -> str:
    """與 JSON 等價的機器可讀格式：每個比率都有 k、n、value、lo、hi 五欄；沒有指標（停用／壞資料）的欄位留空。"""
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["tribe", "input_freshness", "artifact_integrity", "runtime_rebuild_loadable", "gate", "snapshot_stale"]
               + [f"{name}_{part}" for name in _CSV_RATIOS for part in _CSV_PARTS])
    for t in report["tribes"]:
        L, m = t["layers"], t["metrics"]
        row = [t["tribe"], L["input_freshness"], L["artifact_integrity"], L["runtime_rebuild_loadable"], L["gate"], t["snapshot_stale"]]
        for name in _CSV_RATIOS:
            if m:
                ratio = _csv_ratio(m, name)
                row += ["" if ratio[part] is None else ratio[part] for part in _CSV_PARTS]
            else:
                row += [""] * len(_CSV_PARTS)
        w.writerow(row)
    return buf.getvalue()


def render(report: dict, fmt: str) -> str:
    if fmt == "json":
        return json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    return (render_csv(report) if fmt == "csv" else render_table(report) + "\n")


def write_atomic(path: Path, text: str) -> None:
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


class Command(BaseCommand):
    help = "唯讀：各族語形態分析的能力報表（放行率／精確率／錯放行率與四層狀態）。"

    def add_arguments(self, parser):
        parser.add_argument("--format", choices=["table", "json", "csv"], default="table")
        parser.add_argument("--output", default=None, help="寫到這個檔案（原子寫入）；省略則印到標準輸出")
        parser.add_argument("--artifact", default=None, help="放行檔路徑（預設為執行期使用的那份）")

    def handle(self, *args, **opts):
        path = Path(opts["artifact"]) if opts["artifact"] else ARTIFACT_PATH
        db = SessionLocal()
        try:
            report = build(db, path)
        except Exception as exc:
            raise CommandError(f"產生報表失敗：{type(exc).__name__}")
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
