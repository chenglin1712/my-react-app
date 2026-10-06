"""句子填空題的「有語言學意義的干擾項」：不再隨機抽別的詞，而是拿正確答案的詞根，
換上別的詞綴（或把中綴放錯位置），造出長得像、但辭典與語料都找不到的錯誤詞形。

這樣選項真的在測詞綴與焦點，而不是在測「哪個詞我看過」。

**這些只是「候選」錯誤形，不是保證不合法的詞**：族語辭典與語料不可能涵蓋所有合法詞形，
造出來的形式有可能碰巧是真的詞，只是我們的資料裡沒有。所以：
1. 候選必須同時不在辭典詞條、也不在語料例句出現過的詞形裡（見 TribeKit.is_known）；
2. 只用「辭典自己標註了詞根」的目標詞出題；用到的詞綴（正確答案的與拿來替換的）都必須同時是
   (a) 辭典歸納出的常見規則（出現次數 >= MIN_RULE_SUPPORT）且 (b) 在人工整理的詞綴表
   （grammar_affix）裡。歸納規則偶爾會從辭典雜訊學到不是詞綴的片段（例如單獨一個 -n），
   詞綴表把這類片段擋掉；
3. 整個功能預設關閉（FeatureFlag quiz_morphology_distractors），任何一步出錯都退回原本的
   隨機干擾項，不能讓出題失敗；
4. 每個「正確詞綴→替換詞綴」組合都要在整本辭典上量過「已收錄詞形命中率」（造出的候選有多少本來
   就是辭典或語料裡的詞），而且 Wilson 95% 上界要夠低、樣本要夠多才採用。注意這個數字只量得到
   「已經收錄的真詞」，量不到「真的存在、只是辭典與語料沒收」的詞——後者才是真正的風險，無法
   在這裡估計，只能靠 sample_quiz_distractors 抽樣請懂族語的人判斷；
5. 命中率與抽樣檢查見 adminapi 的 sample_quiz_distractors 指令。

防作弊：引擎造的干擾項沒有音檔，如果只有它們沒有喇叭圖示，答對者就能靠「有沒有發音」
猜答案。所以只要這一題用了任何引擎干擾項，整題所有選項都不附音檔。

全部只用 ORM 查詢，不用任何單一資料庫專有的 SQL（正式環境是 PostgreSQL、SQLite 當備份）。
"""
from __future__ import annotations

import hashlib
import logging
import random
from dataclasses import dataclass, replace
from typing import Mapping

from sqlalchemy.orm import Session

from config import morphology as M
from config import translation_lexicon as lexicon
from dictionary_db.model import GrammarAffix, TranslationAttestedForm, Word

from fastAPI import feature_flags
from config.morphology_calibration import wilson_upper

from ..keyed_cache import KeyedCache

logger = logging.getLogger(__name__)

FLAG = "quiz_morphology_distractors"

MIN_PAIRS_FOR_RULES = 500        # 辭典衍生詞標註少於這個數量的族語不出（歸納出的規則不可靠）
MIN_RULE_SUPPORT = 10            # 詞綴規則在辭典裡至少出現幾次才算「常見詞綴」
MIN_ROOT_LEN = 3
MAX_SWAP_POOL = 8                # 換詞綴時，從支持度最高的幾條規則裡挑
MIN_PAIR_SAMPLES = 30            # 「正確詞綴→替換詞綴」這個組合至少要有幾個樣本才量得出命中率
MAX_PAIR_HIT_UPPER = 0.15        # 已收錄詞形命中率的 Wilson 95% 上界超過這個就不用（30 個樣本得 0 次命中才過）
MAX_SHIFT_POSITION = 4           # 中綴位置最多往後挪到詞根第幾個字母之後
KIND_SWAP = "affix-swap"
KIND_SHIFT = "infix-shift"


@dataclass(frozen=True)
class Distractor:
    word: str
    kind: str
    note: str
    # 以下三個欄位給詞素診斷（diagnosis.py）用：這個干擾項是用哪條規則造的、正確答案的規則是哪條、
    # 詞根是什麼。舊的呼叫端只用前三個欄位，不受影響。
    used_rule: M.MorphRule | None = None
    target_rule: M.MorphRule | None = None
    root: str = ""


@dataclass(frozen=True)
class TribeKit:
    lexicon: frozenset[str]                          # 正規化後的辭典詞條名
    attested: frozenset[str]                         # 正規化後、例句裡出現過的詞形
    roots_by_derived: Mapping[str, tuple[str, ...]]  # 辭典標註的 衍生詞 -> 詞根們（已清洗）
    rules: Mapping[M.MorphRule, int]                 # 歸納出的常見詞綴規則 -> 出現次數
    # (正確詞綴, 替換詞綴) -> (造出的候選數, 其中本來就是真詞的數量)；撞詞率太高的組合不用
    pair_stats: Mapping[tuple[M.MorphRule, M.MorphRule], tuple[int, int]]
    # 這份詞庫的指紋（規則、採用的詞綴組合、詞庫大小）；出題當下記進題目 token，之後才知道
    # 一筆作答是依哪一版詞庫診斷的。測試手工組的 kit 可以不給。
    version: str = ""

    def is_known(self, norm: str) -> bool:
        return norm in self.lexicon or norm in self.attested

    def pair_allowed(self, rule0: M.MorphRule, rule: M.MorphRule) -> bool:
        """這個組合造出的候選，在整本辭典上實測有多常本來就是已收錄的詞；樣本不足或命中率的
        95% 上界太高就不用。例如葛瑪蘭語 ma-→pa- 實測約一半是已收錄的詞（使役／狀態的對應），
        拿它當錯誤選項會害學生答對卻被判錯。用上界而不是點估計，是因為樣本少時 0/20 也不能
        證明真實命中率低；而且這個命中率只量得到已收錄的詞（見模組說明第 4 點）。"""
        n, known = self.pair_stats.get((rule0, rule), (0, 0))
        return n >= MIN_PAIR_SAMPLES and wilson_upper(known, n) <= MAX_PAIR_HIT_UPPER


_KITS: KeyedCache[str, TribeKit | None] = KeyedCache()


def invalidate(tribe_id: str | None = None) -> None:
    """辭典、例句語料或詞綴有異動時呼叫（/internal/cache/invalidate）。None＝全部族語。"""
    if tribe_id is None:
        for key in _KITS.keys():
            _KITS.invalidate(key)
    else:
        _KITS.invalidate(tribe_id)


def canonical_marker(text: str) -> str:
    """把詞綴表的寫法（"-i-（中綴）"、"m- / ma-"、"u-...-an"）整理成跟 MorphRule.marker 同一種
    寫法（"-i-"、"m-"、"u-…-an"），整理不出東西就回傳空字串。"""
    text = (text or "").strip().replace("...", "…").replace("⋯", "…")
    for sep in ("（", "(", "／", "/", " "):
        text = text.split(sep, 1)[0]
    return text.strip().lower()


def _build_kit(db: Session, tribe_id: str, tribe_full_name: str) -> TribeKit | None:
    rows = db.query(Word.name, Word.derivative_root).filter(Word.tribe_id == tribe_id).all()
    lex = {lexicon.normalize_token(name or "") for name, _ in rows}
    lex.discard("")
    pairs, _ = M.build_pairs([(tribe_full_name, name, root) for name, root in rows if root and root.strip()])
    if len(pairs) < MIN_PAIRS_FOR_RULES:
        return None
    curated = {canonical_marker(a) for (a,) in db.query(GrammarAffix.affix).filter(GrammarAffix.tribe_id == tribe_id).all()}
    induced = M.induce_rules(pairs, {w for w in lex if " " not in w}, min_count=MIN_RULE_SUPPORT, kinds="PSIC")
    rules = {r: n for r, n in induced.items() if r.marker in curated}
    if not rules:
        return None
    attested = {n for (n,) in db.query(TranslationAttestedForm.surface_form_norm)
                .filter(TranslationAttestedForm.tribe_id == tribe_id).all()}
    kit = TribeKit(frozenset(lex), frozenset(attested), {p.derived: p.roots for p in pairs}, dict(rules), {})
    measured = TribeKit(kit.lexicon, kit.attested, kit.roots_by_derived, kit.rules, _measure_pairs(kit))
    return replace(measured, version=_kit_version(measured))


def _kit_version(kit: TribeKit) -> str:
    digest = hashlib.sha1()
    for rule in sorted(kit.rules):
        digest.update(f"{rule.kind}|{rule.a}|{rule.b}|{rule.k}|{kit.rules[rule]};".encode("utf-8"))
    for rule0, rule in sorted(p for p in kit.pair_stats if kit.pair_allowed(*p)):
        digest.update(f"{rule0.marker}>{rule.marker};".encode("utf-8"))
    # 詞庫、語料詞形與衍生詞標註的【內容】都要進指紋，只看筆數的話，內容換了、筆數沒變就會誤以為同一版。
    digest.update("\x00".join(sorted(kit.lexicon)).encode("utf-8"))
    digest.update(b"\x01")
    digest.update("\x00".join(sorted(kit.attested)).encode("utf-8"))
    digest.update(b"\x01")
    for derived in sorted(kit.roots_by_derived):
        digest.update(f"{derived}={'/'.join(kit.roots_by_derived[derived])};".encode("utf-8"))
    return digest.hexdigest()[:12]


def _measure_pairs(kit: TribeKit) -> dict[tuple[M.MorphRule, M.MorphRule], tuple[int, int]]:
    """對每個有辭典標註詞根的詞，造出所有候選，統計每個 (正確詞綴, 替換詞綴) 組合的撞詞數。"""
    stats: dict[tuple[M.MorphRule, M.MorphRule], list[int]] = {}
    for norm in kit.roots_by_derived:
        found = _recover_rule(kit, norm)
        if found is None:
            continue
        root, rule0 = found
        for cand, rule in _swap_candidates(kit, root, rule0) + _shift_candidates(root, rule0):
            if cand == norm:
                continue
            entry = stats.setdefault((rule0, rule), [0, 0])
            entry[0] += 1
            entry[1] += kit.is_known(cand)
    return {k: (v[0], v[1]) for k, v in stats.items()}


def get_kit(db: Session, tribe) -> TribeKit | None:
    """每族語第一次用到時建立並快取。None＝這個族語資料不足、不出這種干擾項
    （None 不會被快取，下次請求會重試——資料不足的族語重試成本是一次 words 查詢）。"""
    return _KITS.get_or_compute(tribe.id, lambda: _build_kit(db, tribe.id, tribe.full_name))


# ---------------------------------------------------------------------------
# 純函式核心（不碰 DB，方便獨立測試）
# ---------------------------------------------------------------------------

def _recover_rule(kit: TribeKit, norm: str) -> tuple[str, M.MorphRule] | None:
    """目標詞在辭典裡有標註詞根時，回傳 (詞根, 解釋它的常見詞綴規則)；否則 None。"""
    for root in kit.roots_by_derived.get(norm, ()):
        if len(root) < MIN_ROOT_LEN:
            continue
        usable = [r for r in M.derive_rules(norm, root, "PSIC") if r in kit.rules]
        if usable:
            return root, M.simplest_rule(usable)
    return None


def recover_rule_detail(kit: TribeKit, norm: str) -> tuple[str, M.MorphRule, bool] | None:
    """同 _recover_rule，另外回報這個詞的規則歸屬是否「有歧義」：同一對（衍生詞, 詞根）有不只一條
    常見規則能解釋，或不同的辭典詞根各自指向不同規則。歧義時 simplest_rule 只是決定性的啟發式，
    不是語言學上的真值，所以詞素診斷遇到歧義的詞不更新熟練度。"""
    chosen: tuple[str, M.MorphRule] | None = None
    ambiguous = False
    for root in kit.roots_by_derived.get(norm, ()):
        if len(root) < MIN_ROOT_LEN:
            continue
        usable = [r for r in M.derive_rules(norm, root, "PSIC") if r in kit.rules]
        if not usable:
            continue
        rule = M.simplest_rule(usable)
        if len(usable) > 1:
            ambiguous = True
        if chosen is None:
            chosen = (root, rule)
        elif (root, rule) != chosen:
            ambiguous = True
    return (chosen[0], chosen[1], ambiguous) if chosen else None


def _swap_candidates(kit: TribeKit, root: str, rule0: M.MorphRule) -> list[tuple[str, M.MorphRule]]:
    same_kind = sorted((r for r in kit.rules if r.kind == rule0.kind),
                       key=lambda r: (-kit.rules[r], r))[:MAX_SWAP_POOL]
    out: list[tuple[str, M.MorphRule]] = []
    for r in same_kind:
        # 中綴只換詞綴本身、位置沿用正確答案的位置（位置不同是另一種錯法，見 _shift_candidates）；
        # 否則會同時換了詞綴與位置，也可能套用超出這個詞根長度的位置（那樣 generate 出來其實是後綴形）。
        # 換成自己（造出的就是答案）或同一個中綴出現在不同位置，都由 _acceptable／take() 的去重處理。
        used = M.MorphRule("I", r.a, k=rule0.k) if r.kind == "I" else r
        out.append((used.generate(root), used))
    return out


def _shift_candidates(root: str, rule0: M.MorphRule) -> list[tuple[str, M.MorphRule]]:
    if rule0.kind != "I":
        return []
    out = []
    for k in range(1, min(MAX_SHIFT_POSITION, len(root) - 1) + 1):
        r = M.MorphRule("I", rule0.a, k=k)
        out.append((r.generate(root), r))
    return out


def _acceptable(kit: TribeKit, cand: str, target: str) -> bool:
    # 候選一定由詞根（>= MIN_ROOT_LEN 個字母）加上詞綴造出，長度與字元一定合法，不用再檢查；
    # 但不同規則可能造出同一個字串（例如詞根 tata 把中綴 a 放在第 1 或第 2 個字母之後都是 taata），
    # 所以必須排除「碰巧等於正確答案」的候選。
    return cand != target and not kit.is_known(cand)


def distractors_for(kit: TribeKit, surface: str, count: int = 3, *, rng: random.Random | None = None) -> list[Distractor]:
    """替 surface（填空題的正確答案，辭典裡的詞條名）造最多 count 個候選錯誤詞形，
    造不出來（沒有辭典標註的詞根、詞綴不常見、詞形被正規化改過…）就回傳空 list。

    surface 必須已經是正規化形式（小寫、ASCII 撇號），或只有首字母大寫：干擾項是從正規化
    形式造的，若目標詞帶有特殊字元，干擾項的寫法就會跟它不一致、讓人一眼看出誰是正解。"""
    rng = rng or random
    norm = lexicon.normalize_token(surface)
    if surface != norm and surface != norm.capitalize():
        return []
    found = _recover_rule(kit, norm)
    if found is None:
        return []
    root, rule0 = found

    def shape(cand: str) -> str:
        return cand.capitalize() if surface != norm else cand

    swaps = [(c, r) for c, r in _swap_candidates(kit, root, rule0)
             if kit.pair_allowed(rule0, r) and _acceptable(kit, c, norm)]
    shifts = [(c, r) for c, r in _shift_candidates(root, rule0)
              if kit.pair_allowed(rule0, r) and _acceptable(kit, c, norm)]
    rng.shuffle(swaps)
    rng.shuffle(shifts)

    picked: list[Distractor] = []
    seen: set[str] = set()

    def take(items, kind, note_for):
        for cand, rule in items:
            if len(picked) >= count:
                return
            if cand in seen:
                continue
            seen.add(cand)
            picked.append(Distractor(shape(cand), kind, note_for(rule), used_rule=rule, target_rule=rule0, root=root))

    # 先各取一個不同種類，再用換詞綴補滿；題目才不會三個選項都是同一種錯法。
    take(shifts[:1], KIND_SHIFT, lambda r: f"詞根「{root}」的中綴「-{r.a}-」應在第 {rule0.k} 個字母之後，這裡放在第 {r.k} 個之後")
    take(swaps, KIND_SWAP, lambda r: f"詞根「{root}」換成別的詞綴「{r.marker}」（正確是「{rule0.marker}」）")
    take(shifts[1:], KIND_SHIFT, lambda r: f"詞根「{root}」的中綴「-{r.a}-」應在第 {rule0.k} 個字母之後，這裡放在第 {r.k} 個之後")
    return picked


# ---------------------------------------------------------------------------
# 給出題流程用的入口
# ---------------------------------------------------------------------------

class DistractorSource:
    """一次出題期間共用的干擾項來源；包住族語的 TribeKit。"""

    def __init__(self, kit: TribeKit):
        self.kit = kit

    def for_word(self, surface: str, count: int = 3) -> list[Distractor]:
        try:
            return distractors_for(self.kit, surface, count)
        except Exception:                     # 干擾項只是加分功能，絕不能讓出題失敗
            logger.exception("quiz distractor generation failed for %r", surface)
            return []


def source_for(db: Session, tribe) -> DistractorSource | None:
    """旗標關閉、族語資料不足、或建立失敗都回傳 None，呼叫端就走原本的隨機干擾項。"""
    try:
        if not feature_flags.is_enabled(FLAG, default=False):
            return None
        kit = get_kit(db, tribe)
    except Exception:                         # 旗標查詢失敗視為關閉（fail-closed），出題照常
        logger.exception("quiz distractor setup failed for tribe %s", getattr(tribe, "id", None))
        return None
    return DistractorSource(kit) if kit is not None else None
