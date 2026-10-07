"""唯讀：列出每個族語目前的校準輸入（辭典／配對／語料詞形）筆數與指紋，並與放行檔記錄的比較。

不寫任何檔案、不改任何執行期設定，只查詢辭典；可隨時執行、隨時丟掉輸出。

  python manage.py report_morphology_inputs            # 表格
  python manage.py report_morphology_inputs --json     # 固定順序、可逐位元組比對的 JSON

欄位說明：
- headwords／pairs 的「現在」值來自 adminapi/morphology_inputs.py（與校準指令同一份載入邏輯）；
- 「放行檔」值是 morphology_rules.json 裡記錄的指紋；兩者不同＝放行檔對這份辭典是舊資料快照；
- attested（語料詞形）指紋目前放行檔（schema 1）沒有記錄，所以只顯示現在值，不判斷新舊；
- loadable／loadable_reason 用的是執行期同一份判斷（config/morphology_artifact.assess_artifact_entry），
  回答「放行檔現在能不能被載入」；指紋一致不代表能載入（例如最終測試未通過、產生器版本過期）。

決定性的範圍：資料與資料庫回傳列順序相同時，輸出逐位元組相同。配對指紋沿用校準指令的算法，對「同一衍生詞
多個詞根的出現順序」敏感，而辭典查詢沒有 order_by（刻意保留，改了會讓既有放行檔的配對指紋變動）；所以
PostgreSQL 若改變列的實體回傳順序，配對指紋理論上可能跟著變。這是已知限制，不是報表獨有的問題。
"""
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from adminapi.morphology_inputs import load_tribe_inputs, tribe_row_name
from config import morphology_artifact as artifact
from config import morphology_calibration as C
from config.tribes import TRIBES
from dictionary_db.connect import SessionLocal
from fastAPI.routes.translation.morph import ARTIFACT_PATH


def _without_exception_text(reason: str) -> str:
    """「載入失敗（例外種類）：例外訊息」只保留到例外種類——訊息可能含檔案路徑或內部細節。"""
    head, sep, _ = reason.partition("）：")
    return head + "）" if sep and head.startswith("載入失敗（") else reason


def collect(db, artifact_path: Path, tribes=TRIBES) -> dict:
    return collect_with_artifact(db, artifact_path, tribes)[0]


def collect_with_artifact(db, artifact_path: Path, tribes=TRIBES) -> tuple[dict, dict | None]:
    """純讀取、結果只依資料決定（不含時間或路徑），所以同樣資料重跑輸出逐位元組相同。
    回傳 (報表, 放行檔的 tribes 或 None)：放行檔只在這裡讀一次，呼叫端要用放行檔內容時用同一份，
    才不會在兩次讀取之間檔案被換掉而組出混合版本。「可載入」判斷也用這同一份內容（assess_loaded_artifact），五族不會混用不同版本。"""
    data = None
    try:
        data = artifact.read_artifact(artifact_path)
        artifact_error, art_tribes, generator = None, data["tribes"], data.get("generator")
    except Exception as exc:
        # 只記例外種類：訊息可能含檔案路徑，會讓不同路徑的輸出不一致
        artifact_error, art_tribes, generator = type(exc).__name__, {}, None
        read_failure = f"載入失敗（{type(exc).__name__}）"

    rows = []
    for tribe in tribes:
        inputs = load_tribe_inputs(db, tribe)
        pairs, _ = inputs.build_pairs()
        now = {
            "headwords_sha256": C.headword_fingerprint(inputs.lexicon_set),
            "pairs_sha256": C.pairs_fingerprint(pairs),
            "attested_sha256": C.attested_fingerprint(inputs.attested),
            "n_word_rows": inputs.word_row_count,
            "n_headwords": len(inputs.lexicon_set),
            "n_pairs": len(pairs),
            "n_attested": len(inputs.attested),
        }
        if data is None:
            loadable = artifact.EntryAssessment(False, read_failure)
        else:
            loadable = artifact.assess_loaded_artifact(data, tribe.slug, tribe.id, lambda: now["headwords_sha256"])
        entry = art_tribes.get(tribe.slug)
        fp = entry.get("fingerprint") if isinstance(entry, dict) else None
        fp = fp if isinstance(fp, dict) else None
        recorded = None if fp is None else {k: fp.get(k) for k in ("headwords_sha256", "pairs_sha256", "n_headwords", "n_pairs")}
        rows.append({
            "tribe": tribe.slug,
            "tribe_in_database": tribe_row_name(db, tribe) is not None,
            "now": now,
            "artifact": recorded,
            "artifact_enabled": entry.get("enabled") if isinstance(entry, dict) else None,
            # None＝放行檔沒有這一族的紀錄，無從比較；True／False＝是否與放行檔記錄一致
            "loadable": loadable.ok,
            "loadable_reason": _without_exception_text(loadable.reason),
            "headwords_match": None if recorded is None else recorded["headwords_sha256"] == now["headwords_sha256"],
            "pairs_match": None if recorded is None else recorded["pairs_sha256"] == now["pairs_sha256"],
        })
    return {"artifact_generator": generator, "artifact_error": artifact_error, "tribes": rows}, (art_tribes if artifact_error is None else None)


def render_table(report: dict) -> str:
    lines = [f"放行檔產生器：{report['artifact_generator']}" + (f"　讀取失敗：{report['artifact_error']}" if report["artifact_error"] else "")]
    mark = {True: "一致", False: "不一致（舊資料快照）", None: "放行檔無紀錄"}
    for r in report["tribes"]:
        n = r["now"]
        lines.append(
            f"{r['tribe']:8s} 資料庫{'有' if r['tribe_in_database'] else '【無】'}此族語｜詞條列 {n['n_word_rows']}｜詞庫 {n['n_headwords']}"
            f"｜配對 {n['n_pairs']}｜語料詞形 {n['n_attested']}｜詞庫指紋 {mark[r['headwords_match']]}｜配對指紋 {mark[r['pairs_match']]}"
            f"｜可載入 {'是' if r['loadable'] else '否：' + r['loadable_reason']}"
        )
    return "\n".join(lines)


class Command(BaseCommand):
    help = "唯讀：各族語目前的校準輸入筆數與指紋，並與放行檔比較（不寫檔）。"

    def add_arguments(self, parser):
        parser.add_argument("--json", action="store_true", help="輸出固定順序的 JSON")
        parser.add_argument("--artifact", default=None, help="放行檔路徑（預設為執行期使用的那份）")

    def handle(self, *args, **opts):
        path = Path(opts["artifact"]) if opts["artifact"] else ARTIFACT_PATH
        db = SessionLocal()
        try:
            report = collect(db, path)
        except Exception as exc:
            raise CommandError(f"讀取辭典失敗：{type(exc).__name__}: {exc}")
        finally:
            db.close()
        if opts["json"]:
            self.stdout.write(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))
        else:
            self.stdout.write(render_table(report))
