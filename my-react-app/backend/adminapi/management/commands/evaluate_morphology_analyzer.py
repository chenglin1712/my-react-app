"""評估族語詞形分析器（config/morphology.py）：留出衍生詞對照，比較三種方式
能不能還原詞根，並量「亂造詞被錯放行」的比例。唯讀，不寫入任何資料。

三種比較對象：
- 只查詞條原形：衍生詞本身就是詞條，直接查表得到的是詞自己而不是詞根，依定義
  還原詞根的準確率是 0，不另外計算。
- 現有單層剝詞綴：translation_lexicon.build_strip_rules（grammar_affix 的人工
  詞綴表，最多剝一層）。
- 歸納規則：從訓練配對（words.derivative_root）自動歸納，另外列出加上重疊、
  依精確度排序、容許編輯距離的各階段。

資料清洗、切分方式與規則定義都在 config/morphology.py，這裡不重複實作，確保
評估跟實際使用的分析器是同一套程式。清洗與切分的細節與各丟棄原因的筆數會一併
印出，因為詞根欄位實測有很多雜訊（逗號分隔、結尾編號、音節連字號、中文說明），
評估結果能不能信取決於這一步。

用法：
    python manage.py evaluate_morphology_analyzer [--tribe SLUG] [--seed N]

為什麼要看「錯放行」：之後若把分析器接進翻譯的佐證檢核，錯誤放行（把不存在的
詞判成有依據）比漏判嚴重得多。準確率高不代表安全——這裡用「把留出測試的真詞
改掉一個／兩個字母、或換成隨機字串」造出不在詞庫裡的詞，看分析器有多常替它
找到詞根。模糊比對階段的放行率很高，所以它只能當提示，不能當佐證。
"""
import random

from django.core.management.base import BaseCommand, CommandError

from config import morphology as M
from config.tribes import TRIBES
from config.translation_lexicon import build_strip_rules, normalize_token
from dictionary_db.connect import SessionLocal
from dictionary_db.model import GrammarAffix, TranslationAttestedForm, Word

# 訓練配對少於這個數量的族語，歸納出來的規則沒有統計意義（布農語、排灣語目前
# 都在這個數字以下），仍會列出結果但標示「資料不足」。
MIN_TRAIN_PAIRS_FOR_RELIABLE_RULES = 500

_LETTERS = "abcdefghijklmnopqrstuvwxyz"


def _substitute(word: str, index: int, rng: random.Random) -> str:
    return word[:index] + rng.choice([c for c in _LETTERS if c != word[index]]) + word[index + 1:]


def _corrupt_one(word: str, rng: random.Random) -> str:
    """改掉一個內部字母（詞首詞尾以外，短詞才允許動到邊緣）。"""
    inner = range(1, len(word) - 1) if len(word) > 3 else range(len(word))
    return _substitute(word, rng.choice(list(inner)), rng)


def _corrupt_two(word: str, rng: random.Random) -> str | None:
    """改掉兩個【不同位置】的字母；太短放不下兩個不同位置就回傳 None（跳過）。
    如果兩次改到同一個位置，實際只差一個字母，不能標成「改 2 個字母」。"""
    if len(word) < 4:
        return None
    i, j = rng.sample(range(1, len(word) - 1), 2) if len(word) > 4 else rng.sample(range(len(word)), 2)
    return _substitute(_substitute(word, i, rng), j, rng)


def _random_string(word: str, rng: random.Random) -> str:
    return "".join(rng.choice(_LETTERS) for _ in range(len(word)))


class Command(BaseCommand):
    help = "評估族語詞形分析器（留出衍生詞對照＋亂造詞錯放行檢查），唯讀"

    def add_arguments(self, parser):
        parser.add_argument("--tribe", default=None, help="只評估單一族語（slug，例如 tayal）；不指定則評估全部五族")
        parser.add_argument("--seed", type=int, default=7, help="亂造詞的亂數種子（預設 7，固定才能重現）")

    def handle(self, *args, **options):
        targets = TRIBES
        if options["tribe"]:
            targets = [t for t in TRIBES if t.slug == options["tribe"]]
            if not targets:
                raise CommandError(f"不支援的族語 slug：{options['tribe']}")

        db = SessionLocal()
        try:
            rows = []
            lexicons: dict[str, set[str]] = {}
            attested: dict[str, set[str]] = {}
            affix_rows: dict[str, list[dict]] = {}
            for tribe in targets:
                name = tribe.full_name
                words = db.query(Word.name, Word.derivative_root).filter(Word.tribe_id == tribe.id).all()
                lexicons[name] = {normalize_token(n) for n, _ in words if n and normalize_token(n)}
                rows.extend((name, n, r) for n, r in words if r and r.strip())
                attested[name] = {
                    s for (s,) in db.query(TranslationAttestedForm.surface_form_norm)
                    .filter(TranslationAttestedForm.tribe_id == tribe.id).all()
                }
                affix_rows[name] = [
                    {"affix": a, "function": f}
                    for a, f in db.query(GrammarAffix.affix, GrammarAffix.function)
                    .filter(GrammarAffix.tribe_id == tribe.id).all()
                ]
        finally:
            db.close()

        pairs, dropped = M.build_pairs(rows)
        self.stdout.write(f"衍生詞→詞根配對：清洗後 {len(pairs)} 筆；丟棄 {dict(dropped)}")

        for tribe in targets:
            self._evaluate_tribe(
                tribe.full_name,
                [p for p in pairs if p.tribe == tribe.full_name],
                lexicons[tribe.full_name], attested[tribe.full_name], affix_rows[tribe.full_name],
                random.Random(options["seed"]),
            )

    def _evaluate_tribe(self, name, pairs, lexicon_set, attested, affix_rows, rng):
        train = [p for p in pairs if not M.is_test_pair(p.tribe, p.derived)]
        test = [p for p in pairs if M.is_test_pair(p.tribe, p.derived)]
        # 主要評估子集：至少有一個正確詞根在詞庫裡。詞根不在詞庫的案例，分析器依設計
        # 不可能答對（它只輸出能在詞庫驗證的詞根），混進總分只會讓數字偏低。
        primary = [p for p in test if set(p.roots) & lexicon_set]

        self.stdout.write(self.style.MIGRATE_HEADING(
            f"\n== {name}：訓練 {len(train)}／留出 {len(test)}／主要評估 {len(primary)}／詞庫 {len(lexicon_set)}"
        ))
        if len(train) < MIN_TRAIN_PAIRS_FOR_RELIABLE_RULES:
            self.stdout.write(self.style.WARNING(
                f"  資料不足（訓練配對 < {MIN_TRAIN_PAIRS_FOR_RELIABLE_RULES}），下列歸納規則的數字沒有統計意義，不建議使用。"
            ))
        if not primary:
            self.stdout.write("  沒有可評估的留出配對。")
            return

        strip_rules = build_strip_rules(affix_rows)

        def existing(token):
            return list(dict.fromkeys(
                c.residue for c in strip_rules.strip_candidates(token)
                if c.residue in lexicon_set and c.residue != token
            ))

        rules = M.induce_rules(train, lexicon_set)
        precision = M.estimate_rule_precision(train, rules, lexicon_set)
        count_rules = M.induce_rules(train, lexicon_set, kinds="PSIC")

        def build(rank_by, max_edit, rule_set, min_rule_precision=0.0):
            return M.MorphAnalyzer(
                rule_set, lexicon_set, precision=precision if rank_by == "precision" else None,
                rank_by=rank_by, max_edit=max_edit, min_rule_precision=min_rule_precision,
            )

        # (完整名稱, 錯放行那幾行用的短名, 現有做法的函式, 分析器)
        systems = [
            ("現有單層剝詞綴", "現有", existing, None),
            ("歸納規則 P/S/I/C，依頻次排序", "頻次", None, build("count", 0, count_rules)),
            ("歸納規則＋重疊，依規則精確度排序（直接命中）", "精確度", None, build("precision", 0, rules)),
            ("　同上，只用規則精確度≥0.5 的規則", "門檻.5", None, build("precision", 0, rules, 0.5)),
            ("　同上＋模糊比對 edit≤1，無門檻（僅供提示）", "模糊", None, build("precision", 1, rules)),
            ("　同上＋模糊比對 edit≤1，規則精確度≥0.5", "模糊+門檻", None, build("precision", 1, rules, 0.5)),
        ]

        def predictor(fn, analyzer, top_n):
            return fn if fn else (lambda tok: [x.root for x in analyzer.analyze(tok, top_n)])

        self.stdout.write(f"  歸納規則 {len(rules)} 條；現有人工詞綴表 {len(affix_rows)} 筆")
        self.stdout.write("  還原詞根（留出的真實衍生詞）：")
        for label, _short, fn, analyzer in systems:
            m = M.evaluate(predictor(fn, analyzer, 3), primary)
            self.stdout.write(
                f"    {label}\n      有候選 {m.coverage:.1%}｜第1名 {m.top1_acc:.1%}｜前3名 {m.top3_acc:.1%}"
                f"｜有答案時第1名 {m.precision_at_1:.1%}"
            )

        # 負例：造出「不在詞庫與語料詞形內」的假詞，看各系統會替它找到詞根的比例（錯放行）。
        # 注意各組負例的威脅模型不同，不能只看一個數字：
        # - 改1/2個字母、隨機字串：離真詞很近或完全隨機，前者偏嚴格、後者偏寬鬆。
        # - 保留詞綴、只編造詞幹：最像 LLM 的幻覺（詞綴對、詞幹是亂編的），最值得看。
        real = [p.derived for p in test]
        negatives = {}
        for label, corrupt in (("改1個字母", _corrupt_one), ("改2個字母（不同位置）", _corrupt_two),
                               ("隨機字串", _random_string)):
            negatives[label] = [w for w in (corrupt(p.derived, rng) for p in test)
                                if w and w not in lexicon_set and w not in attested]
        stem_fakes = []
        for p in test:
            for root in p.roots:
                if root not in lexicon_set or len(root) < 3:
                    continue
                derived_rules = M.derive_rules(p.derived, root)
                if not derived_rules:
                    continue
                fake_root = _corrupt_one(root, rng)
                fake = M.simplest_rule(derived_rules).generate(fake_root)
                if fake_root not in lexicon_set and fake not in lexicon_set and fake not in attested and fake != p.derived:
                    stem_fakes.append(fake)
                break
        negatives["保留真實詞綴、只編造詞幹"] = stem_fakes

        self.stdout.write("  亂造詞被錯放行的比例（有任何候選就算放行；越低越好）：")
        for label, fakes in negatives.items():
            if not fakes:
                continue
            cells = []
            for _label, short, fn, analyzer in systems:
                accepted = sum(1 for w in fakes if predictor(fn, analyzer, 1)(w))
                cells.append(f"{short} {accepted / len(fakes):.1%}")
            self.stdout.write(f"    {label}（n={len(fakes)}）：" + "｜".join(cells))
        cells = []
        for _label, short, fn, analyzer in systems:
            cells.append(f"{short} {sum(1 for w in real if predictor(fn, analyzer, 1)(w)) / len(real):.1%}")
        self.stdout.write("    （對照）留出的真實衍生詞被放行：" + "｜".join(cells))
