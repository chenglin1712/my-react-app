"""族語對照表單一資料來源。

原本 dictionary.py（TRIBE_MAP）、listening.py／sentence.py（TRIBE_IDS）、
crawler/dictionary_source.py（TRIBE_IDS）、CrosswordPuzzle/views.py（_TRIBE_IDS）
各自重複寫了一份幾乎相同的族語對照表，新增族語要改五個地方。這裡集中成
唯一資料來源，其餘檔案改成從這裡 import。

id 對應 dictionary.db 的 tribe.id（見 fastAPI/routes/model.py 的 Tribe 表、
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

# 英文代稱 -> tribe_id UUID（原本各檔案的 TRIBE_IDS）
TRIBE_IDS = {_t.slug: _t.id for _t in TRIBES}
