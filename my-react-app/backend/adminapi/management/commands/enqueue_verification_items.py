"""把量測／基準報表裡的候選放進待專家驗證佇列（M5）。預設只預覽（dry-run），加 --apply 才寫入。

  python manage.py enqueue_verification_items --from-coverage coverage.json            # 預覽
  python manage.py enqueue_verification_items --from-coverage coverage.json --apply
  python manage.py enqueue_verification_items --from-benchmark bench.json --tribe amis --max 100 --apply

來源（只接受這兩種報告，並驗證版本與結構，不接受看起來相似的任意 JSON）：
- measure_sentence_coverage（measurement_version 3）：每個族語「只去詞條名稱頭尾空白」之後仍未對到的高頻詞形
  → unmatched_form。不用「照實際存放」的清單，避免把詞條名稱空白造成的假缺口丟給專家。
- benchmark_morphology（benchmark_version 1）：評估時分析器給了錯誤詞根的案例 → morph_analysis。
  注意：這些案例來自凍結切分 final-v1；請專家看是為了釐清標註，【不得】拿結果回頭調規則或門檻再對 final-v1 評估。

兩份報告的清單都是「截斷的樣本」（--top-n／--max-items 的上限），不是完整母體；每筆觀測記下來源報告當時列出的筆數（list_size），
畫面也只稱「報告抽樣」。排序固定（族語、種類、詞次大到小、再依詞形），--max 是第二層截斷。

【全有或全無】先驗證全部候選（與寫入共用同一個 validate_candidate，所以預覽與寫入的判斷必然一致）；只要有任何一筆不合法，
整批都不寫（列出前幾筆錯誤）。驗證通過後才在單一 transaction 裡寫入，中途失敗整批 rollback。
相同報告重跑不會重複建立（key 相同），只會更新該報告的觀測。佇列只存詞形與計數，不存句子；只寫 Verification* 三張表，不碰辭典或干擾項。
"""
import hashlib
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from adminapi import verification_service as svc
from adminapi.models.verification import KIND_MORPH_ANALYSIS, KIND_UNMATCHED_FORM

SYSTEM_ACTOR = "system:enqueue_verification_items"
MAX_SOURCE_BYTES = 20_000_000
MAX_LIMIT = 1000
MAX_ERRORS_SHOWN = 10


def _load(path: str):
    p = Path(path)
    if not p.is_file():
        raise CommandError("找不到來源檔")
    if p.stat().st_size > MAX_SOURCE_BYTES:
        raise CommandError("來源檔太大")
    raw = p.read_bytes()
    try:
        return json.loads(raw.decode("utf-8")), hashlib.sha256(raw).hexdigest()[:16]
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise CommandError("來源檔不是合法的 UTF-8 JSON")


def candidates_from_coverage(report: dict, label: str, tribes=None):
    if not isinstance(report, dict) or report.get("measurement_version") != 3 or not isinstance(report.get("tribes"), list):
        raise CommandError("不是 measure_sentence_coverage 的 measurement_version 3 報告")
    out = []
    try:
        for t in report["tribes"]:
            slug = t["tribe"]
            top = t["counterfactuals"]["edge_whitespace_trimmed"]["production_multiword_unmatched"]["top"]
            if tribes and slug not in tribes:
                continue
            for entry in top:
                out.append((slug, KIND_UNMATCHED_FORM, entry["form"], None, svc.ObservationInput(
                    "coverage", 3, label, entry["count"], entry["sentences"], len(top))))
    except (KeyError, TypeError, AttributeError):
        raise CommandError("報告結構不符（缺少只去頭尾空白的未對到清單，或欄位型別不對）")
    return out


def candidates_from_benchmark(report: dict, label: str, tribes=None):
    if not isinstance(report, dict) or report.get("benchmark_version") != 1 or not isinstance(report.get("tribes"), list):
        raise CommandError("不是 benchmark_morphology 的 benchmark_version 1 報告")
    out = []
    try:
        for t in report["tribes"]:
            slug = t["tribe"]
            if tribes and slug not in tribes:
                continue
            result = t.get("result")
            if not result:
                continue
            items = result["failure_analysis"]["wrong_root_items"]
            for it in items:
                proposal = {"predicted_root": it["predicted_root"], "rule": it["rule"], "gold_roots": it["gold_roots"]}
                out.append((slug, KIND_MORPH_ANALYSIS, it["derived"], proposal,
                            svc.ObservationInput("benchmark", 1, label, 1, 0, len(items))))
    except (KeyError, TypeError, AttributeError):
        raise CommandError("報告結構不符（缺少 wrong_root_items，或欄位型別不對）")
    return out


class Command(BaseCommand):
    help = "把 coverage／benchmark 報告裡的候選放進待專家驗證佇列（預設 dry-run；--apply 才寫入；任一筆不合法就整批不寫）。"

    def add_arguments(self, parser):
        src = parser.add_mutually_exclusive_group(required=True)
        src.add_argument("--from-coverage")
        src.add_argument("--from-benchmark")
        parser.add_argument("--tribe", action="append", default=None, help="只處理這個族語（slug，可重複）")
        parser.add_argument("--max", type=int, default=200, help=f"最多處理幾筆（1～{MAX_LIMIT}；排序固定）")
        parser.add_argument("--apply", action="store_true", help="真的寫入；沒有這個旗標只預覽")

    def handle(self, *args, **opts):
        if not 1 <= opts["max"] <= MAX_LIMIT:
            raise CommandError(f"--max 必須介於 1 到 {MAX_LIMIT}")
        tribes = set(opts["tribe"]) if opts["tribe"] else None
        if tribes and tribes - svc.TRIBE_SLUGS:
            raise CommandError("未知的族語：" + "、".join(sorted(tribes - svc.TRIBE_SLUGS)))
        if opts["from_coverage"]:
            report, label = _load(opts["from_coverage"])
            raw = candidates_from_coverage(report, label, tribes)
            source_name = "coverage"
        else:
            report, label = _load(opts["from_benchmark"])
            raw = candidates_from_benchmark(report, label, tribes)
            source_name = "benchmark"
            self.stdout.write(self.style.WARNING(
                "提醒：這些案例來自凍結切分 final-v1；專家意見只能用來釐清標註，不得據此調整規則或門檻後再對 final-v1 評估。"))

        # 階段一：對【整份報告】的每一筆候選做完整驗證（預覽與寫入共用），然後才排序與截斷；
        # 所以不合法的候選不可能因為排在 --max 之外而逃過檢查。任何一筆不合法就整批不寫
        valid, errors = [], []
        for tribe, kind, form, proposal, obs in raw:
            try:
                valid.append(svc.validate_candidate(tribe, kind, form, proposal, obs))
            except svc.ValidationFailed as exc:
                errors.append(f"（{tribe}）{str(form)[:40]!r}：{exc}")
        if errors:
            shown = "；".join(errors[:MAX_ERRORS_SHOWN])
            more = f"（另有 {len(errors) - MAX_ERRORS_SHOWN} 筆）" if len(errors) > MAX_ERRORS_SHOWN else ""
            raise CommandError(f"來源報告有 {len(errors)} 筆不合法的候選，整批都沒有寫入：{shown}{more}")

        # 固定順序後截斷：先依族語與種類，再依詞次大到小、詞形、提案（驗證過，所以詞次一定是整數；不依賴來源檔的順序）
        valid.sort(key=lambda c: (c.tribe, c.kind, -c.obs.occurrence_count, c.form, json.dumps(c.proposal, sort_keys=True, ensure_ascii=False)))
        valid = valid[: opts["max"]]

        # 階段二
        if opts["apply"]:
            result = svc.enqueue_batch(valid, SYSTEM_ACTOR)
            verb, created, existing = "已寫入", result["created"], result["already_exist"]
        else:
            result = svc.preview_candidates(valid)
            verb, created, existing = "預覽（沒有寫入）", result["would_create"], result["already_exist"]
        self.stdout.write(f"{verb}：來源 {source_name}（報告雜湊 {label}），處理 {len(valid)} 筆——"
                          f"{'新建' if opts['apply'] else '會新建'} {created}、已存在 {existing}。"
                          f"清單是報告的抽樣，不是完整母體。")
        if not opts["apply"]:
            self.stdout.write("加上 --apply 才會真的寫入。")
