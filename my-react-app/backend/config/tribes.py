"""族語對照表單一資料來源。

原本 dictionary.py（TRIBE_MAP）、listening.py／sentence.py（TRIBE_IDS）、
crawler/dictionary_source.py（TRIBE_IDS）、CrosswordPuzzle/views.py（_TRIBE_IDS）
各自重複寫了一份幾乎相同的族語對照表，新增族語要改五個地方。這裡集中成
唯一資料來源，其餘檔案改成從這裡 import。

id 對應 dictionary.db 的 tribe.id（見 dictionary_db/model.py 的 Tribe 表、
alembic/versions/00a315a8dfa8_...），純資料、不依賴 Django 或 FastAPI，
兩邊都能直接 import。
"""

from typing import NamedTuple


class TribeInfo(NamedTuple):
    slug: str        # 英文代稱，例如 "tayal"
    short_name: str   # 中文簡稱，例如 "泰雅"
    full_name: str    # 中文全名，對應 tribe.name，例如 "泰雅語"
    id: str           # tribe.id（UUID）


TRIBES = [
    TribeInfo("tayal",   "泰雅",   "泰雅語",   "fc76ed97-0dd8-4587-82ad-7a6dbe125001"),
    TribeInfo("amis",    "阿美",   "阿美語",   "e68273b9-1f2b-4c42-8d95-f52189ab24b7"),
    TribeInfo("bunun",   "布農",   "布農語",   "865a96e3-3384-45b3-8bd0-e1f799b75515"),
    TribeInfo("kavalan", "葛瑪蘭", "葛瑪蘭語", "c5974f37-b49d-466a-ab24-6893ab4ef6a5"),
    TribeInfo("paiwan",  "排灣",   "排灣語",   "19c77a3b-3a81-496f-b0f4-afe6d9155edd"),
]

# 英文代稱／中文簡稱 -> 中文全名（原本各檔案的 TRIBE_MAP）
TRIBE_MAP = {}
for _t in TRIBES:
    TRIBE_MAP[_t.slug] = _t.full_name
    TRIBE_MAP[_t.short_name] = _t.full_name

# dictionary.db 的 tribe.name 沿用舊譯名「葛瑪蘭語」（見 kavalan_bank.py 開頭說明），
# 但「噶瑪蘭」才是正確漢字，前端一律改顯示「噶瑪蘭」後，這裡補一個別名，
# 讓兩種拼法都能查到同一個 tribe，不必動到既有 DB 資料
TRIBE_MAP["噶瑪蘭"] = TRIBE_MAP["葛瑪蘭"]

# 英文代稱 -> tribe_id UUID（原本各檔案的 TRIBE_IDS）
TRIBE_IDS = {_t.slug: _t.id for _t in TRIBES}

_VALID_FULL_NAMES = frozenset(_t.full_name for _t in TRIBES)


def resolve_tribe_name(tribe: str) -> str:
    """把使用者輸入的族語代稱／簡稱／全名解析成 tribe.name 全名，找不到就丟 ValueError。

    先前多處呼叫端是用 TRIBE_MAP.get(tribe, 某個預設值) 這種「查無則吃預設值」的寫法：
    dictionary/search.py 直接預設成泰雅語，打錯字或帶入不支援的族語時會靜默回傳泰雅語
    的真實資料而非報錯；dictionary/grammar.py、audio_proxy.py 則是預設成輸入本身，
    查無資料時安靜回傳空結果／404，一樣不會讓呼叫端知道自己傳的族語是錯的。
    listening.py／sentence.py／quiz.py 用 TRIBE_IDS.get(tribe) 對同一種情況正確回傳
    400，這裡統一成同樣「查無則報錯」的行為。允許直接傳全名（如「泰雅語」）通過，
    是因為 grammar.py 這幾個端點原本的 fallback 行為就會讓全名直接命中，這裡維持
    相容，只收斂「傳完全不存在的族語」這個真正的錯誤情況。
    """
    name = TRIBE_MAP.get(tribe)
    if name is not None:
        return name
    if tribe in _VALID_FULL_NAMES:
        return tribe
    raise ValueError(f"不支援的族語：{tribe}")
