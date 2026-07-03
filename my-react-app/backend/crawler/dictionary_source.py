"""
共用工具：即時查詢本專案既有的 `backend/fastAPI/routes/dictionary.db`
（原住民族語言線上辭典 ILRDF 資料，跟辭典搜尋、詞彙遊戲等功能共用同一份資料庫），
供各族語 `xxx_bank.py` 的「中高級配合題」選題公式使用。

設計理念：中高級配合題只寫死「這一類要考哪些中文詞義」（等於課程設計上的
考點清單，屬於選題邏輯），實際的外語拼寫/中文釋義一律在每次出題時即時向
dictionary.db 查詢，不再把詞彙內容複製一份寫死在程式碼裡——資料庫內容之後
如果被辭典維運者訂正、擴充，題庫會自動反映最新資料。

高級閱讀克漏字的短文則不適用這套機制：短文需要挑選語意通順、能設計出
「詞彙語意型／語言結構型」干擾選項的真實例句組合而成，這部分本來就需要
人工編審判斷，沒辦法單純用一個查詢條件自動產生，因此各族語 xxx_bank.py
的 CLOZE_PASSAGES 仍是人工從 dictionary.db 的真實例句裡挑選、核對後寫入。
"""

import json
import os
import random
import sqlite3

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.normpath(os.path.join(BASE_DIR, "..", "fastAPI", "routes", "dictionary.db"))

# 各族語在 dictionary.db 裡的 tribe_id（跟 fastAPI/routes/listening.py、
# sentence.py 的 TRIBE_IDS 是同一份資料庫、同一組值，這裡只取本題庫用得到的
# 幾個族語，避免讓 Django app 額外相依 FastAPI 那邊的模組）。
TRIBE_IDS = {
    "tayal": "fc76ed97-0dd8-4587-82ad-7a6dbe125001",
    "amis": "e68273b9-1f2b-4c42-8d95-f52189ab24b7",
    "bunun": "865a96e3-3384-45b3-8bd0-e1f799b75515",
}


def fetch_words_by_glosses(tribe, glosses):
    """
    依「想測驗的中文詞義」清單，即時從 dictionary.db 撈出對應的真實詞條。

    glosses: 例如 ["狗", "豬", "牛"]——這是「要考哪些概念」的課程設計清單，
             不是外語內容本身。
    回傳：{中文詞義: {"word": 外語拼寫, "chinese": 中文詞義}}，
          資料庫裡查無對應詞義的項目會直接被跳過（不會出現在回傳結果裡）。
    """
    tribe_id = TRIBE_IDS.get(tribe)
    if not tribe_id:
        return {}

    gloss_set = set(glosses)
    found = {}

    con = sqlite3.connect(DB_PATH)
    try:
        con.row_factory = sqlite3.Row
        cur = con.cursor()
        cur.execute(
            "SELECT name, explanation_items FROM words WHERE tribe_id=?",
            (tribe_id,),
        )
        rows = cur.fetchall()
    finally:
        con.close()

    for row in rows:
        try:
            items = json.loads(row["explanation_items"])
        except (TypeError, ValueError):
            continue
        for item in items:
            expl = (item.get("chineseExplanation") or "").strip()
            if expl in gloss_set and expl not in found:
                found[expl] = {"word": row["name"], "chinese": expl}

    return found


def sample_matching_vocab(tribe, category_targets, category_quota):
    """
    依 category_quota 對每個類別即時查詢 dictionary.db 並不放回抽樣，
    回傳打散後的詞彙清單，供各族語 build_matching_test() 直接使用。

    有些語言的代詞/功能詞彙義項會共用同一個外語拼寫（例如同一個字同時是
    「你」跟「你的」），若兩個中文詞義剛好查到同一個外語詞，這裡會確保
    同一次出的題目裡，同一個外語拼寫不會重複出現在兩張配對卡上
    （否則配對遊戲會出現重複卡片、配對邏輯也會衝突）。
    """
    picked = []
    used_words = set()
    for category, quota in category_quota.items():
        candidates = list(fetch_words_by_glosses(tribe, category_targets[category]).values())

        seen = set()
        pool = []
        for c in candidates:
            if c["word"] in used_words or c["word"] in seen:
                continue
            seen.add(c["word"])
            pool.append(c)

        quota = min(quota, len(pool))
        chosen = random.sample(pool, quota)
        picked.extend(chosen)
        used_words.update(c["word"] for c in chosen)

    random.shuffle(picked)
    return picked
