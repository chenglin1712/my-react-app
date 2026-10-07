"""詞形分析器接進翻譯佐證檢核的執行期載入層。

config/morphology.py 歸納出的詞綴規則，經 build_morphology_rules 指令校準、挑出可
放行的少數幾條，存成 backend/config/morphology_rules.json。這裡負責在執行期把它變成
一個可以被 retrieve.corroborate_tokens() 使用的探針（MorphProbe）。

安全原則（錯誤放行比漏判嚴重得多）：
1. **功能預設關閉**，要明確打開 FeatureFlag（translation_morphology_analyzer）。旗標
   查詢一律寫 default=False（fail-closed），跟其他旗標預設 fail-open 相反。旗標關閉
   時連放行檔都不讀、不查資料庫。
2. **只用直接命中**（max_edit=0）：模糊比對實測會讓六到九成的亂造詞找到詞根，絕不
   能當佐證，這裡根本不建模糊索引。
3. **載入失敗一律停用**，絕不讓請求丟例外：放行檔缺失／格式錯／規則非法／族語不在
   檔內／族語 ID 對不上／詞庫內容雜湊對不上，都只記 warning 並回傳「停用」。
4. **內容雜湊不符就整族停用**：放行檔綁定產生時的辭典內容，辭典變了就不能再用舊
   檔的校準結果。
5. 停用狀態也會快取（帶存活時間），避免持續故障時每個請求都重讀檔案、重查資料庫。
6. **shadow 模式**：只記錄「分析器本來會把哪些詞升級成 derived」，不改任何輸出，
   讓真實流量先驗證再開。

分析器只是追加候選：候選仍交給 retrieve.corroborate_tokens() 現有的資料庫查詢
（詞庫／語料詞形）確認才算 derived——但那不是一道獨立的把關（分析器自己的詞庫就是
同一批詞庫），真正的安全性來自規則放行的校準，不要誤解成雙重驗證。
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from config import morphology as M
from config import morphology_artifact as artifact
from config import morphology_calibration as C
from config import translation_lexicon as lexicon
from config.tribes import TRIBES
from dictionary_db.model import GrammarAffix, Word

from ..keyed_cache import KeyedCache

logger = logging.getLogger(__name__)

FLAG_APPLY = "translation_morphology_analyzer"
FLAG_SHADOW = "translation_morphology_shadow"

ARTIFACT_PATH = Path(C.__file__).resolve().parent / "morphology_rules.json"

# 停用狀態的快取存活時間（秒）：故障修好後最慢這麼久會自動重試，而不是永遠停用或每個
# 請求都重試。
_DISABLED_TTL_SECONDS = 300
# 啟用狀態主要靠 /internal/cache/invalidate 更新；這個較長的存活時間只是「通知遺失」的保險
# （多 worker 其中一個漏收到失效通知時，最慢這麼久後會重建，重建時會重新驗證詞庫指紋）。
_ENABLED_TTL_SECONDS = 6 * 3600
_MAX_RULES = artifact.MAX_RULES   # 放行檔規則數量上限，防止異常檔案撐爆記憶體

_TRIBE_SLUG_BY_ID = {t.id: t.slug for t in TRIBES}


@dataclass(frozen=True)
class MorphCandidate:
    """跟 translation_lexicon.StripCandidate 一樣有 residue 與 note，讓
    corroborate_tokens() 對兩種候選一視同仁。"""
    residue: str
    note: str


class MorphProbe:
    """某個族語的分析器探針。不可變；shadow=True 時只記錄、不影響輸出。"""

    def __init__(self, analyzer: M.MorphAnalyzer, function_table: dict[str, str], tribe_id: str, shadow: bool):
        if analyzer.max_edit != 0:
            # 模糊比對絕不能進佐證檢核；就算有人誤傳，也在這裡擋下。
            raise ValueError("佐證檢核只能使用直接命中的分析器（max_edit 必須是 0）")
        self._analyzer = analyzer
        self._functions = function_table
        self.tribe_id = tribe_id
        self.shadow = shadow

    def candidates(self, norm_token: str) -> list[MorphCandidate]:
        """對一個已正規化的 token 回傳直接命中的詞根候選（由好到壞）。"""
        out: list[MorphCandidate] = []
        for a in self._analyzer.analyze(norm_token, top_n=3):
            if a.stage != "exact":
                continue
            func = M.describe_rule(a.rule, self._functions)
            note = f"依形態規則推定：{a.rule.marker}" + (f"（{func}）" if func else "")
            out.append(MorphCandidate(a.root, note))
        return out

    def record_shadow(self, surface: str, residue: str, note: str) -> None:
        logger.info("[morph-shadow] tribe=%s surface=%r residue=%r %s", self.tribe_id, surface, residue, note)


# ---------------------------------------------------------------------------
# 放行檔的讀取與驗證
# ---------------------------------------------------------------------------

# 讀檔、規則解析、「這一族現在能不能載入」的判斷在 config/morphology_artifact.py（純函式、不丟例外），
# 後台報表用同一份判斷，才不會報表說可載入、執行期卻不行。這裡只負責快取、存活時間與記錄。
_read_artifact = artifact.read_artifact
_parse_rules = artifact.parse_rules


@dataclass(frozen=True)
class _Entry:
    analyzer: M.MorphAnalyzer | None
    function_table: dict[str, str]
    reason: str = ""
    expires_at: float | None = None     # 停用與啟用狀態各有存活時間（見上方常數）


def _disabled(reason: str, log: bool = True) -> _Entry:
    if log:
        logger.warning("[morph] 詞形分析器停用：%s", reason)
    return _Entry(None, {}, reason, time.monotonic() + _DISABLED_TTL_SECONDS)


def _build_entry(db: Session, tribe_id: str, artifact_path: Path | None = None) -> _Entry:
    """永遠回傳 _Entry、永遠不丟例外。"""
    slug = _TRIBE_SLUG_BY_ID.get(tribe_id)
    if slug is None:
        return _disabled(f"未知的族語 ID：{tribe_id}")
    try:
        loaded: dict = {}

        def current_fingerprint() -> str:
            # 只有放行檔前面所有檢查都通過才會查資料庫；查到的詞庫也順便給下面建分析器用
            names = [n for (n,) in db.query(Word.name).filter(Word.tribe_id == tribe_id).all() if n]
            lexicon_set = {lexicon.normalize_token(n) for n in names}
            lexicon_set.discard("")
            loaded["lexicon_set"] = lexicon_set
            return C.headword_fingerprint(lexicon_set)

        result = artifact.assess_artifact_entry(artifact_path or ARTIFACT_PATH, slug, tribe_id, current_fingerprint)
        if not result.ok:
            return _disabled(result.reason, log=result.log)

        analyzer = M.MorphAnalyzer(
            result.support, loaded["lexicon_set"], precision=result.reliability, rank_by="precision",
            max_edit=0, min_rule_precision=0.0, min_root_len=result.min_root_len,
        )
        affix_rows = [{"affix": a, "function": f}
                      for a, f in db.query(GrammarAffix.affix, GrammarAffix.function)
                      .filter(GrammarAffix.tribe_id == tribe_id).all()]
        return _Entry(analyzer, M.build_function_table(affix_rows), "", time.monotonic() + _ENABLED_TTL_SECONDS)
    except Exception as exc:   # 建分析器、資料庫——任何一種都只停用，不影響請求
        return _disabled(f"載入失敗（{type(exc).__name__}）：{exc}")


_CACHE: KeyedCache[str, _Entry] = KeyedCache()
# 到期檢查、清除、重建三步必須是一個不可分割的動作：否則兩個請求同時發現同一筆已到期，
# 第二個可能把第一個剛重建好的新狀態又清掉、再重建一次。重建很少發生（只有啟動、失效、
# 到期），用單一全域鎖不會成為瓶頸。
_REBUILD_LOCK = threading.Lock()


def _fresh(entry: _Entry | None) -> bool:
    return entry is not None and (entry.expires_at is None or time.monotonic() < entry.expires_at)


def get_entry(db: Session, tribe_id: str) -> _Entry:
    """取得（或建立）該族語的分析器狀態。過了存活時間（停用 5 分鐘、啟用 6 小時）會重建。"""
    cached = _CACHE.get(tribe_id)
    if _fresh(cached):
        return cached
    with _REBUILD_LOCK:
        cached = _CACHE.get(tribe_id)
        if _fresh(cached):
            return cached
        if cached is not None:
            _CACHE.invalidate(tribe_id)
        return _CACHE.get_or_compute(tribe_id, lambda: _build_entry(db, tribe_id))


def invalidate(tribe_id: str | None = None) -> None:
    """辭典有異動時呼叫（/internal/cache/invalidate）。None 代表全部族語。"""
    if tribe_id is None:
        for key in _CACHE.keys():
            _CACHE.invalidate(key)
    else:
        _CACHE.invalidate(tribe_id)


def probe_for(db: Session, tribe_id: str, *, apply_enabled: bool) -> MorphProbe | None:
    """依旗標狀態回傳探針；該族停用時回傳 None。apply_enabled=False 代表只做 shadow。
    呼叫端要先確認至少有一個旗標開著（兩個都關就不該呼叫這裡）。"""
    entry = get_entry(db, tribe_id)
    if entry.analyzer is None:
        return None
    return MorphProbe(entry.analyzer, entry.function_table, tribe_id, shadow=not apply_enabled)
