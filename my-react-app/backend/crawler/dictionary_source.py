"""
共用工具：即時查詢本專案既有的 `backend/dictionary_db/dictionary.db`
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

import random

from sqlalchemy import text

from config.tribes import TRIBE_IDS
from dictionary_db.connect import SessionLocal


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

    # 走 dictionary_db.connect 共用的 SessionLocal（而非原生 sqlite3.connect
    # 直接開檔），這樣才會走 SQLAlchemy 的 QueuePool，且連線時自動套用該
    # engine 的 connect event listener（PRAGMA foreign_keys / journal_mode =
    # WAL），避免高流量下和其他 SQLAlchemy 連線競爭 WAL 鎖——同一顆
    # dictionary.db 同時被 FastAPI 辭典/測驗端點與這裡存取，理由跟
    # CrosswordPuzzle/views.py 的 _get_words_from_db 一致。
    # explanation_items 已經拆到 word_explanation 表，改成 JOIN 一次撈出
    # 每個字的所有解釋（一個字可能有多筆解釋，所以不能只取第一筆）。
    db = SessionLocal()
    try:
        rows = db.execute(
            text("""SELECT w.name AS name, we.chinese_explanation AS chinese_explanation
                    FROM words w
                    JOIN word_explanation we ON we.word_id = w.id
                    WHERE w.tribe_id = :tribe_id"""),
            {"tribe_id": tribe_id},
        ).fetchall()
    finally:
        db.close()

    for row in rows:
        expl = (row.chinese_explanation or "").strip()
        if expl in gloss_set and expl not in found:
            # 部分詞條的外語拼寫本身在資料庫裡就帶有多餘的前後空白
            # （資料建檔瑕疵），這裡順手清掉，避免顯示或比對時出錯。
            found[expl] = {"word": (row.name or "").strip(), "chinese": expl}

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
