import os
import json
import sqlite3

class TayalDatabaseBuilder:
    def __init__(self, data_folder, db_path):
        self.data_folder = data_folder
        self.db_path = db_path
        self.conn = sqlite3.connect(self.db_path)
        self.create_table()

    def create_table(self):
        """建立 words 資料表"""
        with self.conn:
            self.conn.execute('''
                CREATE TABLE IF NOT EXISTS words (
                    id TEXT PRIMARY KEY,
                    word_tayal TEXT,
                    word_audio TEXT,
                    word_fre TEXT,
                    word_str TEXT,
                    defins JSON,
                    word_img TEXT
                );
            ''')
        print("資料表建立完成。")

    def load_json_files(self):
        """讀取所有 JSON 檔並回傳資料"""
        all_data = {}
        filename = "_tayal_words_all.json"
        filepath = os.path.join(self.data_folder, filename)
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                all_data.update(json.load(f))
        return all_data

    def insert_data(self, data):
        """把資料插入資料庫"""
        with self.conn:
            for word_id, info in data.items():
                self.conn.execute('''
                    INSERT OR REPLACE INTO words (id, word_tayal, word_audio, word_fre, word_str, defins, word_img)
                    VALUES (?, ?, ?, ?, ?, ?, ?);
                ''', (
                    word_id,
                    info.get('word_tayal'),
                    info.get('word_audio'),
                    info.get('word_fre'),
                    info.get('word_str'),
                    json.dumps(info.get('defins', []), ensure_ascii=False),  # 把 defins 轉成字串存
                    info.get('word_img')
                ))
        print("資料插入完成。")

    def close(self):
        self.conn.close()

if __name__ == "__main__":
    db_builder = TayalDatabaseBuilder(data_folder="data", db_path="tayal_words_img.db")
    data = db_builder.load_json_files()
    db_builder.insert_data(data)
    db_builder.close()
    print("資料庫建立完成！")


