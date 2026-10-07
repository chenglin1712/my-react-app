"""形態分析（校準、報表、基準）共用的「資料載入」：一個族語要用到的辭典資料，全部從這裡來。

為什麼要抽出來：build_morphology_rules（校準）與 report_morphology_*（報表）如果各自查詢辭典、各自
正規化，只要有一邊多加一個 filter 或改一次正規化的順序，兩邊算出的詞庫、配對與指紋就會悄悄分叉，
報表就會對著一份跟校準時不一樣的資料說「目前是最新的」。這裡刻意【原樣保留】校準指令原本的查詢與
處理順序（包含沒有 order_by），只是搬家，不順便修任何東西：

- 詞庫：words.name 經 normalize_token 後去重、去空；
- 配對來源列：只取衍生詞標註（derivative_root）非空白的列，族語欄位放 tribe.full_name
  （RootPair.tribe 因此是中文全名，不是 slug——切分用的雜湊標籤包含它，改了會換集合）；
- 語料詞形（attested）：translation_attested_form.surface_form_norm；
- 詞綴表：grammar_affix 的 (affix, function)。

查詢沒有 order_by 是已知的現況：build_pairs 會依「資料列第一次出現的順序」保存配對與詞根順序，而
pairs_fingerprint 對詞根順序敏感。SQLite 與 PostgreSQL 的預設回傳順序不保證相同，這是另一個要獨立處理
的問題（會讓既有放行檔的配對指紋改變），不能混在這次搬家裡。

回傳的是不可變的快照（frozenset／tuple），呼叫端不能就地修改。
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from config import morphology as M
from config.tribes import TribeInfo
from config.translation_lexicon import normalize_token
from dictionary_db.model import GrammarAffix, Tribe, TranslationAttestedForm, Word


@dataclass(frozen=True)
class TribeInputs:
    tribe: TribeInfo
    word_row_count: int                                   # words 表中這個族語的列數（原始列數，不是詞形數）
    lexicon_set: frozenset                                # 正規化、去重、非空的詞庫
    pair_rows: tuple                                      # ((tribe.full_name, name, derivative_root), ...)
    attested: frozenset
    affix_rows: tuple                                     # ({"affix":…, "function":…}, ...)

    def build_pairs(self):
        """(配對 list, 丟棄原因 Counter)，與校準指令使用同一個 config.morphology.build_pairs。"""
        return M.build_pairs(self.pair_rows)


def load_tribe_inputs(db: Session, tribe: TribeInfo) -> TribeInputs:
    words = db.query(Word.name, Word.derivative_root).filter(Word.tribe_id == tribe.id).all()
    lexicon_set = frozenset(normalize_token(n) for n, _ in words if n and normalize_token(n))
    pair_rows = tuple((tribe.full_name, n, r) for n, r in words if r and r.strip())
    attested = frozenset(
        s for (s,) in db.query(TranslationAttestedForm.surface_form_norm)
        .filter(TranslationAttestedForm.tribe_id == tribe.id).all()
    )
    affix_rows = tuple(
        {"affix": a, "function": f}
        for a, f in db.query(GrammarAffix.affix, GrammarAffix.function)
        .filter(GrammarAffix.tribe_id == tribe.id).all()
    )
    return TribeInputs(tribe, len(words), lexicon_set, pair_rows, attested, affix_rows)


def tribe_row_name(db: Session, tribe: TribeInfo) -> str | None:
    """資料庫 tribe 表裡這個 ID 的名稱；查不到回傳 None。TRIBES 設定裡的 UUID 如果打錯，上面的查詢只會得到
    空集合而不會報錯，報表要靠這個檢查才看得出「這個族語根本不在資料庫裡」。"""
    row = db.query(Tribe.name).filter(Tribe.id == tribe.id).first()
    return row[0] if row else None
