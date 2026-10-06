"""測驗「詞形干擾項」（fastAPI/routes/quiz/distractors.py）的體檢與抽樣，唯讀，不寫入任何資料。

回答三個問題：
1. 涵蓋多少？在辭典有標註詞根的詞條裡，有多少能造出至少一個候選錯誤詞形（沒標註詞根的詞、
   詞綴不常見的詞，造不出來就照舊用隨機干擾項）。
2. 已收錄詞形命中率（舊稱撞詞率）多高？造出來的候選（過濾之前）有多少比例本來就是辭典或語料
   裡已收錄的詞。過濾會把已收錄的詞擋掉，但擋不掉「真的存在、只是我們資料沒收」的詞——
   命中率乘上 (1-資料涵蓋率)/資料涵蓋率 只是殘餘風險的【粗略估計】（涵蓋率未知，所以列出 70%
   與 90% 兩種假設；它還假設沒收錄的真詞被造出來的機率跟已收錄的一樣，生產性詞綴下這個假設
   可能偏樂觀）。這不是保證，真正的檢驗是第 3 點的人工抽樣。
3. 看起來對不對？隨機抽 N 題列出來，給懂族語的人逐題判斷；--csv 會輸出一欄空白的「人工判斷」。

用法：
    python manage.py sample_quiz_distractors [--tribe SLUG] [--n 30] [--seed 7] [--csv 路徑]
"""
import csv
import logging
import random

from django.core.management.base import BaseCommand, CommandError

from config.tribes import TRIBES
from dictionary_db.connect import SessionLocal
from dictionary_db.model import Word
from fastAPI.routes.quiz import distractors as D
from config import translation_lexicon as lexicon


class Command(BaseCommand):
    help = "測驗詞形干擾項的涵蓋、撞詞率與抽樣檢查（唯讀）"

    def add_arguments(self, parser):
        parser.add_argument("--tribe", default=None, help="只看單一族語（slug）；不指定則五族都看")
        parser.add_argument("--n", type=int, default=30, help="每個族語抽幾題給人工檢查（預設 30）")
        parser.add_argument("--seed", type=int, default=7)
        parser.add_argument("--csv", default=None, help="把抽樣結果寫成 CSV（含空白的人工判斷欄）")

    def handle(self, *args, **opts):
        targets = [t for t in TRIBES if opts["tribe"] in (None, t.slug)]
        if not targets:
            raise CommandError(f"沒有這個族語：{opts['tribe']}")
        logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)   # 專案預設會印出每一句 SQL
        rng = random.Random(opts["seed"])
        csv_rows = []
        db = SessionLocal()
        try:
            for tribe in targets:
                self._one(db, tribe, opts["n"], rng, csv_rows)
        finally:
            db.close()
        if opts["csv"]:
            with open(opts["csv"], "w", newline="", encoding="utf-8-sig") as fh:
                w = csv.writer(fh)
                w.writerow(["族語", "目標詞", "詞根", "候選錯誤形", "造法", "說明", "人工判斷（真的是錯的/可能是真詞/不確定）"])
                w.writerows(csv_rows)
            self.stdout.write(f"\n抽樣結果已寫入 {opts['csv']}")

    def _one(self, db, tribe, n, rng, csv_rows):
        out = self.stdout.write
        out(f"\n=== {tribe.full_name} ===")
        kit = D._build_kit(db, tribe.id, tribe.full_name)
        if kit is None:
            out("  資料不足（辭典衍生詞標註太少或沒有常見詞綴），不出詞形干擾項，維持隨機干擾項。")
            return
        names = [w for (w,) in db.query(Word.name).filter(Word.tribe_id == tribe.id).all()]
        norm_names = sorted({lexicon.normalize_token(x or "") for x in names} - {""})
        annotated = [x for x in norm_names if x in kit.roots_by_derived]

        eligible, kinds = [], {}
        all_total = sum(n for n, _ in kit.pair_stats.values())
        all_known = sum(k for _, k in kit.pair_stats.values())
        used = {pair: v for pair, v in kit.pair_stats.items() if kit.pair_allowed(*pair)}
        raw_total = sum(n for n, _ in used.values())
        raw_known = sum(k for _, k in used.values())
        for norm in annotated:
            found = D._recover_rule(kit, norm)
            if found is None:
                continue
            root, rule0 = found
            picked = D.distractors_for(kit, norm, 3, rng=rng)
            if picked:
                eligible.append((norm, root, rule0, picked))
                for d in picked:
                    kinds[d.kind] = kinds.get(d.kind, 0) + 1

        out(f"  辭典詞條（正規化後去重） {len(norm_names)}；有標註詞根 {len(annotated)}；"
            f"常見詞綴規則 {len(kit.rules)} 條")
        out(f"  能造出候選干擾項的詞條 {len(eligible)}（占有標註詞根的 {len(eligible) / max(1, len(annotated)):.0%}）；"
            f"造法分布 {kinds}")
        if all_total:
            out(f"  詞綴組合共 {len(kit.pair_stats)} 種，實際採用 {len(used)} 種"
                f"（命中率 95% 上界 <= {D.MAX_PAIR_HIT_UPPER:.0%} 且樣本 >= {D.MIN_PAIR_SAMPLES}）；"
                f"全部組合的整體命中率是 {all_known / all_total:.1%}")
        if raw_total:
            rate = raw_known / raw_total
            out(f"  採用的組合：過濾前 {raw_total} 個候選中有 {raw_known} 個（{rate:.1%}）本來就是辭典或語料已收錄的詞，已被擋掉")
            for cover in (0.7, 0.9):
                out(f"    若資料只涵蓋該族語 {cover:.0%} 的真詞：殘餘風險（候選其實是真詞）約 {rate * (1 - cover) / cover:.1%}")
        sample = rng.sample(eligible, min(n, len(eligible)))
        out(f"  --- 抽樣 {len(sample)} 題（給懂族語的人檢查）---")
        for norm, root, rule0, picked in sample:
            out(f"  {norm}  （詞根 {root}，詞綴 {rule0.marker}）")
            for d in picked:
                out(f"      ✗ {d.word:<18}［{d.kind}］{d.note}")
                csv_rows.append([tribe.full_name, norm, root, d.word, d.kind, d.note, ""])
