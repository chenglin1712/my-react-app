"""
噶瑪蘭語資料匯入腳本
將 Z:\\Desktop\\win\\噶瑪蘭語 的 CSV 資料匯入 dictionary.db

執行方式（在專案根目錄）：
    python -m backend.fastAPI.routes.import_kavalan
"""

import csv
import json
import os
import sqlite3
import uuid
import re

# 路徑設定
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "dictionary.db")
KAVALAN_DIR = os.path.join("Z:\\", "Desktop", "win", "噶瑪蘭語")
STATIC_KAVALAN = os.path.join(BASE_DIR, "..", "static", "kavalan")

# 級別→詞頻數值對應
LEVEL_MAP = {
    "初級": 900,
    "中級": 600,
    "中高級": 300,
    "高級": 100,
}

def get_category_from_filename(filename):
    """從 CSV 檔名取得分類，例如 '01數字計量.csv' → '數字計量'"""
    name = os.path.splitext(filename)[0]
    return re.sub(r'^\d+', '', name).strip()

def parse_csv_files():
    """解析所有 CSV 檔，回傳詞條列表"""
    entries = []
    for fname in sorted(os.listdir(KAVALAN_DIR)):
        if not fname.endswith(".csv"):
            continue
        category = get_category_from_filename(fname)
        fpath = os.path.join(KAVALAN_DIR, fname)
        with open(fpath, encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                entries.append({
                    "number": row.get("編號", "").strip(),
                    "name": row.get("族語", "").strip(),
                    "chinese": row.get("中文", "").strip(),
                    "english": row.get("英文", "").strip(),
                    "note": row.get("備註", "").strip(),
                    "level": row.get("級別", "").strip(),
                    "audio": row.get("音檔", "").strip(),
                    "image": row.get("圖片", "").strip(),
                    "category": category,
                })
    return entries

def load_json_dict():
    """載入噶瑪蘭語辭典 JSON，以 word 為 key 建立查找表"""
    json_path = os.path.join(KAVALAN_DIR, "噶瑪蘭語辭典.json")
    if not os.path.exists(json_path):
        return {}
    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)
    lookup = {}
    for item in data:
        word = item.get("word", "").strip()
        if word:
            lookup[word] = item
    return lookup

def build_explanation_items(entry, json_word=None):
    """建立 explanation_items JSON"""
    items = []
    # 主要解釋來自 CSV
    explanation = {
        "id": str(uuid.uuid4()),
        "chineseExplanation": entry["chinese"],
        "englishExplanation": entry["english"],
        "category": [entry["category"]] if entry["category"] else [],
        "partOfSpeech": [],
        "focus": [],
        "imageUrl": [],
        "sentenceItems": [],
    }

    # 若 JSON 辭典有對應詞條，補充例句
    if json_word:
        for sense in json_word.get("senses", []):
            if sense.get("pos"):
                explanation["partOfSpeech"] = [sense["pos"]]
            if sense.get("focus"):
                explanation["focus"] = [sense["focus"]]
            for ex_text in sense.get("examples", []):
                # 例句格式：「族語句子 中文翻譯」
                parts = ex_text.strip().rsplit(" ", 1)
                original = parts[0] if len(parts) >= 1 else ex_text
                chinese_sent = parts[1] if len(parts) == 2 else ""
                explanation["sentenceItems"].append({
                    "id": str(uuid.uuid4()),
                    "originalSentence": original,
                    "anaphoraSentence": [],
                    "chineseSentence": chinese_sent,
                    "englishSentence": "",
                    "audioItems": [],
                })
    items.append(explanation)
    return items

def build_audio_items(audio_path):
    """建立 audio_items JSON，fileId 以 local/ 開頭表示本地靜態檔"""
    if not audio_path:
        return []
    # audio_path 例如 audio/01數字計量/01_01.wav
    return [{
        "id": str(uuid.uuid4()),
        "fileId": f"local/kavalan/{audio_path}",
        "audioClass": "word",
    }]

def check_local_audio_exists(audio_path):
    """確認靜態目錄中音檔是否存在"""
    if not audio_path:
        return False
    full_path = os.path.join(STATIC_KAVALAN, audio_path)
    return os.path.isfile(full_path)

def check_local_image_exists(image_path):
    """確認靜態目錄中圖片是否存在"""
    if not image_path:
        return False
    full_path = os.path.join(STATIC_KAVALAN, image_path)
    return os.path.isfile(full_path)

def import_to_db():
    entries = parse_csv_files()
    json_dict = load_json_dict()

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 先刪除舊的葛瑪蘭語資料（避免重複匯入）
    cursor.execute("DELETE FROM words WHERE tribe = '葛瑪蘭語'")
    deleted = cursor.rowcount
    print(f"清除舊葛瑪蘭語資料：{deleted} 筆")

    inserted = 0
    skipped = 0

    for entry in entries:
        if not entry["name"]:
            skipped += 1
            continue

        word_id = f"kavalan-{entry['number']}" if entry["number"] else str(uuid.uuid4())
        json_word = json_dict.get(entry["name"])

        explanation_items = build_explanation_items(entry, json_word)
        audio_items = build_audio_items(entry["audio"])
        frequency = LEVEL_MAP.get(entry["level"], 200)

        # 圖片路徑（以靜態 URL 表示）
        word_img = None
        if entry["image"] and check_local_image_exists(entry["image"]):
            word_img = f"/dictionary/static/kavalan/{entry['image']}"
        is_image = bool(word_img)
        has_audio = bool(audio_items) and check_local_audio_exists(entry["audio"])

        # 若有 JSON 辭典的衍生詞根資訊
        derivative_root = None
        variant = None
        if json_word:
            derivative_root = json_word.get("root")
            variants_list = json_word.get("variants") or []
            variant = "、".join(variants_list) if isinstance(variants_list, list) else str(variants_list or "")

        cursor.execute("""
            INSERT OR REPLACE INTO words (
                id, tribe_id, tribe, dialect, name, pinyin,
                variant, formation_word, derivative_root,
                frequency, hit, dictionary_note,
                word_img, sources, explanation_items, audio_items,
                is_derivative_root, is_image, is_zuzucidian, is_other_dialect
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            word_id,
            "kavalan",
            "葛瑪蘭語",
            "",
            entry["name"],
            "",
            variant or "",
            "",
            derivative_root or "",
            frequency,
            0,
            entry["note"],
            word_img,
            json.dumps([], ensure_ascii=False),
            json.dumps(explanation_items, ensure_ascii=False),
            json.dumps(audio_items, ensure_ascii=False),
            False,
            is_image,
            False,
            False,
        ))
        inserted += 1

    conn.commit()
    conn.close()
    print(f"匯入完成：{inserted} 筆，跳過：{skipped} 筆")

if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    import_to_db()
