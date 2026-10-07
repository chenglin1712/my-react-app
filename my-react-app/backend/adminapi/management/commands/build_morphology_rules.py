"""產生族語詞形分析器的「放行規則檔」（backend/config/morphology_rules.json）。

config/morphology.py 從辭典歸納出的詞綴規則並不是全都能拿來當佐證。這支指令負責
挑出可放行的規則：用交叉驗證與負例（假詞）決定哪些規則可信，再用一份凍結後只跑一次
的最終測試（測試詞從詞庫拿掉，模擬沒見過的詞形）驗證，通過才啟用；未通過的族語
整族停用。方法與理由見 config/morphology_calibration.py 的模組說明。

用法：
    python manage.py build_morphology_rules                    # 只印報告，不寫檔
    python manage.py build_morphology_rules --write            # 寫入 config/morphology_rules.json
    python manage.py build_morphology_rules --profile balanced # 稍微放寬錯詞根率換覆蓋率
    python manage.py build_morphology_rules --tribe kavalan
    python manage.py build_morphology_rules --max-wrong-root-upper 0.05   # 更嚴的安全上限

所有「是否夠安全」的目標都是 95% 信賴【上界】的上限（預設：各負例族群錯放行 ≤ 1%、
被接受真詞的錯詞根比例 ≤ 10%）。錯詞根的上限比較寬，是因為辭典的衍生詞標註本身有歧義，
即使規則再嚴也有約 4~6% 的接受案例剝出另一個合理詞根；若把上限收緊到 5%，目前的資料量
不足以證明安全，所有族語都會被停用。這是一個政策選擇，不是演算法的極限。

重要：
- 放行檔是「版本化的模型產物」，不是設定檔。它綁定產生時的辭典內容（檔內記錄詞庫與配對
  的內容雜湊）；執行期載入時若雜湊與目前資料庫對不上，該族會被整族停用，不會悄悄沿用。
  辭典有異動後要重跑這支指令、檢查報告、再提交新檔。
- 要用跟正式環境一致的資料產生（本機 SQLite 副本只能拿來開發，不能決定正式放行）。
- 產生過程是決定性的（固定種子、排序、固定序列化），同樣資料重跑得到逐位元組相同的檔案。
- 放行檔存在不代表功能開啟：翻譯端還要打開 FeatureFlag（見 seed_feature_flags），
  預設關閉。
"""
import json
import os
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from adminapi.morphology_inputs import load_tribe_inputs
from config import morphology as M
from config import morphology_calibration as C
from config.tribes import TRIBES
from config.translation_lexicon import build_strip_rules
from dictionary_db.connect import SessionLocal

DEFAULT_OUTPUT = Path(C.__file__).resolve().parent / "morphology_rules.json"


class Command(BaseCommand):
    help = "產生族語詞形分析器的放行規則檔（唯讀資料庫，預設只印報告）"

    def add_arguments(self, parser):
        parser.add_argument("--tribe", default=None, help="只處理單一族語（slug，例如 kavalan）；不指定則處理全部五族")
        parser.add_argument("--profile", choices=sorted(C.PROFILES), default="strict",
                            help="鬆緊程度（預設 strict：寧可少放行也不要錯放行）")
        parser.add_argument("--max-wrong-root-upper", type=float, default=None,
                            help="被接受的真詞中，剝出錯誤詞根比例的 95%% 信賴上界上限（覆蓋 profile 預設）")
        parser.add_argument("--max-fa-upper", type=float, default=None,
                            help="各負例族群錯放行率的 95%% 信賴上界上限（套用到全部族群，覆蓋 profile 預設）")
        parser.add_argument("--write", action="store_true", help="寫入放行檔；不加則只印報告")
        parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="放行檔路徑")

    def handle(self, *args, **options):
        targets = TRIBES
        if options["tribe"]:
            targets = [t for t in TRIBES if t.slug == options["tribe"]]
            if not targets:
                raise CommandError(f"不支援的族語 slug：{options['tribe']}")

        overrides, ladder = C.PROFILES[options["profile"]]
        overrides = dict(overrides)
        if options["max_wrong_root_upper"] is not None:
            overrides["max_wrong_root_rate"] = options["max_wrong_root_upper"]
        if options["max_fa_upper"] is not None:
            overrides["union_targets"] = {f: options["max_fa_upper"] for f in C.FAMILIES}
        cfg = C.AdmissionConfig(**overrides)
        output = Path(options["output"])

        # --tribe 只處理單一族語時，保留檔案裡其他族語的既有結果，不要整份覆蓋掉。
        existing: dict = {}
        if options["tribe"] and output.exists():
            existing = json.loads(output.read_text(encoding="utf-8")).get("tribes", {})

        db = SessionLocal()
        try:
            # 資料載入與報表指令共用 adminapi/morphology_inputs.py（查詢與處理順序原樣保留）
            data = {tribe.slug: load_tribe_inputs(db, tribe) for tribe in targets}
        finally:
            db.close()

        results = dict(existing)
        for slug, inputs in data.items():
            tribe, lexicon_set, attested = inputs.tribe, inputs.lexicon_set, inputs.attested
            pairs, dropped = inputs.build_pairs()
            strip_rules = build_strip_rules(list(inputs.affix_rows))

            def existing_accepts(token, lex, _sr=strip_rules):
                return any(c.residue in lex for c in _sr.strip_candidates(token))

            entry = C.build_tribe_artifact(slug, tribe.id, pairs, lexicon_set, attested, cfg,
                                           existing_accepts=existing_accepts, ladder=ladder)
            results[slug] = entry
            self._print_entry(tribe.full_name, entry, len(pairs), dict(dropped))

        artifact = C.build_artifact(results)
        text = C.dumps_artifact(artifact)
        if options["write"]:
            output.parent.mkdir(parents=True, exist_ok=True)
            tmp = output.with_suffix(output.suffix + ".tmp")
            tmp.write_text(text, encoding="utf-8", newline="\n")
            os.replace(tmp, output)   # 原子替換，不會留下寫到一半的檔案
            self.stdout.write(self.style.SUCCESS(f"\n已寫入 {output}（{len(text)} 字元）"))
        else:
            self.stdout.write(self.style.WARNING("\n未加 --write，沒有寫入任何檔案。"))

    def _print_entry(self, name, entry, n_pairs, dropped):
        status = self.style.SUCCESS("啟用") if entry["enabled"] else self.style.WARNING("停用")
        self.stdout.write(self.style.MIGRATE_HEADING(f"\n== {name}：{status}（配對 {n_pairs}，詞庫 {entry['fingerprint']['n_headwords']}）"))
        if not entry["enabled"]:
            self.stdout.write(f"  原因：{entry['reason']}")
        cv = entry["cv_union"]
        if cv["real"]:
            fa = "，".join(f"{f} {k}/{n}" for f, (k, n) in cv["fa"].items())
            self.stdout.write(f"  交叉驗證聯集：真詞 {cv['real']} 接受 {cv['accepted']}（錯詞根 {cv['wrong_root']}）；錯放行 {fa}")
        for r in entry["rules"]:
            self.stdout.write(
                f"  規則 {M.MorphRule(r['kind'], r['a'], r['b'], r['k']).marker:<10} 出現 {r['support']:>4} 次｜"
                f"可靠度下界 {r['reliability']:.2f}｜交叉驗證 命中 {r['hits']} 錯詞根 {r['wrong']} 錯放行 {r['fa_hard']}"
            )
        ft = entry["final_test"]
        if ft:
            self.stdout.write(f"  最終測試（凍結後只跑一次，測試詞已從詞庫移除）：評估 {ft['real_evaluated']} 筆，"
                              f"接受 {ft['accepted']}（正確 {ft['correct']}，錯詞根 {ft['wrong_root']}，上界 {ft['wrong_root_upper']:.1%}）")
            for fam, v in ft["fa"].items():
                self.stdout.write(f"    錯放行 {fam:<7} {v['accepted']}/{v['n']} = {v['rate']:.2%}（95% 上界 {v['upper']:.2%}）")
            inc = ft["incremental_over_existing"]
            if inc:
                self.stdout.write(f"    其中現有單層剝詞綴本來就不會放行、這次新增接受的：{inc['accepted']} 筆（正確 {inc['correct']}）")
            self.stdout.write(f"    閘門：{'通過' if ft['passed'] else '未通過 — ' + '；'.join(ft['failed_checks'])}")
