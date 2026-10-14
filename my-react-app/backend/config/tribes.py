"""族語對照表（讀取單一資料來源 tribes.json）。

族群資料的唯一來源是同目錄的 tribes.json（N-6）：識別碼、名稱、羅馬字、色彩、語言代碼、
審閱狀態、各功能是否有內容、預留的 16 族與方言別。前台 frontend/src/constants/tribes.js
讀的是同一個檔案，所以新增族群只改 tribes.json 一處，前後端都會出現。

原本 dictionary.py（TRIBE_MAP）、listening.py／sentence.py（TRIBE_IDS）、
crawler/dictionary_source.py（TRIBE_IDS）、CrosswordPuzzle/views.py（_TRIBE_IDS）
各自重複寫了一份幾乎相同的族語對照表，之後集中到 tribes.py，現在再把資料本身
移到 tribes.json，這個檔案只負責把 JSON 轉成既有的 TRIBES／TRIBE_MAP／TRIBE_IDS 介面，
其餘檔案的 import 不需要改。

id 對應 dictionary.db 的 tribe.id（見 dictionary_db/model.py 的 Tribe 表、
alembic/versions/00a315a8dfa8_...），純資料、不依賴 Django 或 FastAPI，
兩邊都能直接 import。
"""

import json
from pathlib import Path
from typing import NamedTuple

_DATA_PATH = Path(__file__).with_name("tribes.json")


class TribeInfo(NamedTuple):
    slug: str        # 英文代稱，例如 "tayal"
    short_name: str   # 中文簡稱，例如 "泰雅"
    full_name: str    # 資料庫 tribe.name 的實際值，例如 "泰雅語"（噶瑪蘭是舊譯名「葛瑪蘭語」）
    id: str           # tribe.id（UUID）
    display_name: str = ""  # 畫面與 API 回應用的官方全名，例如 "噶瑪蘭語"（full_name 是資料庫舊譯名，不要拿去顯示）


def load_tribe_data(path=_DATA_PATH):
    """讀取 tribes.json，回傳完整的族群清單（含尚未啟用的預留族群）。"""
    with open(path, encoding="utf-8") as f:
        return json.load(f)["tribes"]


def build_tribe_tables(raw_tribes):
    """把 tribes.json 的內容轉成 (TRIBES, TRIBE_MAP, TRIBE_IDS)。

    只有 enabled 為 true 的族群會進入表格；啟用的族群缺 id 或 fullName 時直接丟 ValueError，
    避免漏填資料而在執行時才出現難以追查的錯誤。
    """
    slugs = [entry["slug"] for entry in raw_tribes]
    if len(slugs) != len(set(slugs)):
        raise ValueError("tribes.json：slug 重複")

    tribes = []
    tribe_map = {}
    tribe_ids = {}
    for entry in raw_tribes:
        if not entry.get("enabled"):
            continue
        slug = entry["slug"]
        for field in ("name", "fullName", "id"):
            if not entry.get(field):
                raise ValueError(f"tribes.json：啟用的族群 {slug} 缺少 {field}")
        db_name = entry.get("dbName") or entry["fullName"]
        if entry["id"] in tribe_ids.values():
            raise ValueError(f"tribes.json：id 重複（{slug}）")
        tribes.append(TribeInfo(slug, entry["name"], db_name, entry["id"], entry["fullName"]))
        tribe_ids[slug] = entry["id"]
        # 英文代稱、中文簡稱、顯示全名、資料庫全名、舊寫法別名都解析到同一個資料庫全名
        for key in (slug, entry["name"], entry["fullName"], *entry.get("aliases", [])):
            if tribe_map.get(key, db_name) != db_name:
                raise ValueError(f"tribes.json：名稱「{key}」同時指向兩個族群")
            tribe_map[key] = db_name
    return tribes, tribe_map, tribe_ids


TRIBE_DATA = load_tribe_data()
TRIBES, TRIBE_MAP, TRIBE_IDS = build_tribe_tables(TRIBE_DATA)

# 英文代稱 -> ISO 639-3 語言代碼（沒有核對過的留空，不放進這個表）
TRIBE_LANG_CODES = {t["slug"]: t["langCode"] for t in TRIBE_DATA if t.get("enabled") and t.get("langCode")}

# dictionary.db 的 tribe.name 沿用舊譯名「葛瑪蘭語」（見 kavalan_bank.py 開頭說明），
# 官方用字是「噶瑪蘭」，前台與其他顯示一律用「噶瑪蘭」；兩種寫法都能查到同一個 tribe
# 是由 tribes.json 的 aliases 處理，不必動到既有 DB 資料。

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
