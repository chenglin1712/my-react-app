"""把辭典資料庫（PostgreSQL 為主）複製成 SQLite 備份檔。預設只在旁邊建立一份新檔並驗證，不動現有備份。

  python manage.py export_dictionary_sqlite                         # 建立 dictionary.db.new 並驗證（不替換）
  python manage.py export_dictionary_sqlite --install               # 驗證通過後，舊備份另存到 --backup-dir，再替換

來源是 DICTIONARY_DATABASE_URL／DATABASE_URL 所指的資料庫；如果目前辭典本身就是 SQLite（沒有設定 PostgreSQL），拒絕執行。
只讀取來源；寫入的只有新備份檔（以及 --install 時另存的舊檔）。
"""
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from adminapi import dictionary_sqlite_export as X
from dictionary_db import connect as C

DEFAULT_TARGET = Path(C.DB_PATH)
DEFAULT_BACKUP_DIR = Path("Z:/Desktop/win/pg_backups")


class Command(BaseCommand):
    help = "從 PostgreSQL 辭典庫重建 SQLite 備份檔"

    def add_arguments(self, parser):
        parser.add_argument("--target", default=str(DEFAULT_TARGET))
        parser.add_argument("--backup-dir", default=str(DEFAULT_BACKUP_DIR))
        parser.add_argument("--install", action="store_true")

    def handle(self, *args, **opts):
        if C._is_sqlite:
            raise CommandError("目前辭典資料庫本身就是 SQLite，沒有 PostgreSQL 可複製")
        target = Path(opts["target"])
        new_path = target.with_name(target.name + ".new")
        if new_path.exists():
            raise CommandError(f"{new_path.name} 已存在（上次留下的？），請確認後手動刪除再重跑")
        try:
            report = X.build_sqlite_copy(C.engine, new_path)
            if not X.integrity_ok(new_path):
                raise X.ExportError("SQLite integrity_check 未通過")
        except X.ExportError as exc:
            raise CommandError(str(exc))
        self.stdout.write(f"已建立並驗證 {new_path.name}：{sum(report['tables'].values())} 列／{len(report['tables'])} 張表")
        self.stdout.write(f"主要表列數：{ {k: report['tables'][k] for k in ('words', 'word_source', 'word_explanation')} }")
        main = {k: report["fingerprints"][k] for k in ("words", "word_source", "word_explanation")}
        self.stdout.write(f"已逐表比對列數與內容指紋（{len(report['fingerprints'])} 張表）、外鍵檢查與 integrity_check 皆通過；"
                          f"主要表指紋（前 16 碼）：{main}；alembic：{report['alembic']}")
        if not opts["install"]:
            self.stdout.write("（未替換現有備份。確認後加 --install；新檔暫存在原目錄）")
            return
        try:
            saved, warnings = X.install_backup(new_path, target, Path(opts["backup_dir"]))
        except (X.ExportError, OSError) as exc:
            raise CommandError(f"替換失敗，現有備份未動：{exc}")
        self.stdout.write(f"已替換 {target.name}；舊檔另存為 {saved}")
        for w in warnings:
            self.stdout.write(f"警告（替換已完成，但有後續問題）：{w}")
