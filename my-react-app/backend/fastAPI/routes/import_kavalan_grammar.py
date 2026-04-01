"""
噶瑪蘭語文法資料匯入腳本
將 kavalan_grammar_complete.json 匯入 dictionary.db 的 grammar 資料表

執行方式（在專案根目錄）：
    python -m backend.fastAPI.routes.import_kavalan_grammar
"""

import json
import os
import sqlite3
import uuid

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "dictionary.db")
GRAMMAR_JSON = os.path.join("Z:\\", "Desktop", "win", "噶瑪蘭語", "kavalan_grammar_complete.json")


def create_grammar_table(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS grammar (
            id      TEXT PRIMARY KEY,
            tribe   TEXT,
            section_order INTEGER,
            section_key   TEXT,
            title         TEXT,
            content       TEXT
        )
    """)
    conn.commit()


def import_grammar():
    with open(GRAMMAR_JSON, encoding="utf-8") as f:
        data = json.load(f)

    conn = sqlite3.connect(DB_PATH)
    create_grammar_table(conn)

    # 清除舊資料
    conn.execute("DELETE FROM grammar WHERE tribe = '葛瑪蘭語'")
    deleted = conn.execute("SELECT changes()").fetchone()[0]
    print(f"清除舊文法資料：{deleted} 筆")

    inserted = 0
    for order, (section_key, content) in enumerate(data.items()):
        # 取顯示標題（去掉前綴數字與頓號，如 "一、時態與時貌語氣系統（TAM System）"）
        title = section_key.strip()

        conn.execute("""
            INSERT OR REPLACE INTO grammar (id, tribe, section_order, section_key, title, content)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            str(uuid.uuid4()),
            "葛瑪蘭語",
            order,
            section_key,
            title,
            json.dumps(content, ensure_ascii=False),
        ))
        inserted += 1

    conn.commit()
    conn.close()
    print(f"匯入完成：{inserted} 個章節")


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    import_grammar()
