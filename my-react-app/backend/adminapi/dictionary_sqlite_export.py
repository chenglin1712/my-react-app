"""把辭典資料庫（PostgreSQL 為主）完整複製成一份 SQLite 備份檔，並驗證複製結果。

做法：用 dictionary_db.model 的資料表定義在新的 SQLite 檔建立相同結構，依外鍵順序逐表串流複製（不一次載入整張表）。
一致性與驗證：
- 來源是 PostgreSQL 時，整個匯出（複製、來源列數、來源內容指紋）都在同一個 REPEATABLE READ／READ ONLY 交易快照裡完成，
  匯出期間別人新增或刪除資料，不會讓父子表來自不同時間點；
- 驗證涵蓋【所有】資料表：逐表比對列數與內容指紋（每列以 JSON 編碼，NULL 與空字串不會混淆），來源與備份各自用同一個
  Python 函式計算；另外對備份檔做 PRAGMA foreign_key_check 與 integrity_check。
只讀取來源資料庫；寫入的只有新建的備份檔。替換既有備份檔由 install_backup() 另外負責，並且一定先把舊檔另存。
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

from sqlalchemy import create_engine, select, text

from dictionary_db.model import Base

CHUNK = 5000


class ExportError(RuntimeError):
    pass


def _row_text(row) -> str:
    # JSON 編碼：None → null、字串一律加引號，所以 NULL 與空字串、含分隔符的內容都不會混淆
    return json.dumps([None if v is None else str(v) for v in row], ensure_ascii=False)


def _order_by(table):
    return [c for c in table.primary_key.columns] or list(table.columns)


def table_fingerprint(conn, table) -> str:
    h = hashlib.sha256()
    for row in conn.execute(select(table).order_by(*_order_by(table))).yield_per(CHUNK):
        h.update(_row_text(row).encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest()


def _open_snapshot(src_engine):
    """回傳來源連線；PostgreSQL 時開啟 REPEATABLE READ + READ ONLY 的一致快照（SQLite 來源沒有這個需求，直接用）。"""
    conn = src_engine.connect()
    if src_engine.dialect.name == "postgresql":
        conn = conn.execution_options(isolation_level="REPEATABLE READ")
        conn.execute(text("SET TRANSACTION READ ONLY"))
    return conn


def build_sqlite_copy(src_engine, dest_path: Path) -> dict:
    """在 dest_path 建立新的 SQLite 檔並複製全部資料；回傳驗證報告。dest_path 必須不存在；任何失敗都不留殘檔。"""
    if dest_path.exists():
        raise ExportError(f"目標檔已存在，不覆蓋：{dest_path.name}")
    dest_engine = create_engine(f"sqlite:///{dest_path.as_posix()}")
    tables = list(Base.metadata.sorted_tables)
    report = {"tables": {}, "fingerprints": {}}
    src = None
    try:
        Base.metadata.create_all(dest_engine)
        src = _open_snapshot(src_engine)
        with dest_engine.begin() as dst:
            for t in tables:
                n = 0
                result = src.execution_options(stream_results=True).execute(select(t).order_by(*_order_by(t)))
                for chunk in result.mappings().partitions(CHUNK):
                    dst.execute(t.insert(), [dict(r) for r in chunk])
                    n += len(chunk)
                report["tables"][t.name] = n
            # alembic 版本記錄（不在 Base.metadata 裡）：來源有就一併複製，讓備份檔仍可被 alembic 辨識
            try:
                rows = src.execute(text("select version_num from alembic_version")).fetchall()
            except Exception:
                rows = []
            dst.execute(text("create table if not exists alembic_version (version_num varchar(32) not null primary key)"))
            for (v,) in rows:
                dst.execute(text("insert into alembic_version (version_num) values (:v)"), {"v": v})
            report["alembic"] = [r[0] for r in rows]
        with dest_engine.connect() as dst:
            for t in tables:        # 全部資料表：列數＋內容指紋；來源側用同一個快照
                src_n = src.execute(select(text("count(*)")).select_from(t)).scalar()
                dst_n = dst.execute(select(text("count(*)")).select_from(t)).scalar()
                if not (src_n == dst_n == report["tables"][t.name]):
                    raise ExportError(f"列數不符：{t.name}（來源 {src_n}／備份 {dst_n}）")
                a, b = table_fingerprint(src, t), table_fingerprint(dst, t)
                if a != b:
                    raise ExportError(f"內容指紋不符：{t.name}")
                report["fingerprints"][t.name] = a[:16]
            bad = dst.execute(text("pragma foreign_key_check")).fetchall()
            if bad:
                raise ExportError(f"備份檔外鍵檢查失敗：{len(bad)} 筆（例：{tuple(bad[0])}）")
    except Exception:
        if src is not None:
            src.close()
        dest_engine.dispose()
        for suffix in ("", "-wal", "-shm", "-journal"):
            p = Path(str(dest_path) + suffix)
            if p.exists():
                p.unlink()
        raise
    src.close()
    dest_engine.dispose()
    return report


def integrity_ok(path: Path) -> bool:
    con = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    try:
        return con.execute("pragma integrity_check").fetchone()[0] == "ok"
    finally:
        con.close()


def install_backup(new_path: Path, target_path: Path, backup_dir: Path) -> tuple[Path, list[str]]:
    """把驗證過的新備份檔換成正式備份：先把舊檔（含 -wal／-shm）另存到 backup_dir，再原子替換。
    舊檔的 -wal 不是空的（可能有尚未寫回的資料）或替換失敗（檔案被其他程式使用）就中止，不動任何東西。
    替換成功之後才做的清理（刪除舊檔的 -wal／-shm）如果失敗，不能說成『沒換』：回傳 (舊檔另存路徑, 警告清單)。
    呼叫前請先停止所有使用 SQLite 備份的程式；這裡只做 best-effort 的檢查。"""
    wal = Path(str(target_path) + "-wal")
    if wal.exists() and wal.stat().st_size > 0:
        raise ExportError("舊備份檔有未寫回的 -wal，可能有程式正在使用；請先停止使用它再替換")
    backup_dir.mkdir(parents=True, exist_ok=True)
    saved = backup_dir / f"{target_path.stem}_{datetime.now():%Y%m%d_%H%M%S_%f}_{os.getpid()}.sqlite.old"
    if target_path.exists():
        shutil.copy2(target_path, saved)
        if saved.stat().st_size != target_path.stat().st_size:
            raise ExportError("舊檔另存後大小不符，中止")
    os.replace(new_path, target_path)               # 失敗（例如檔案被佔用）會拋 OSError，舊檔仍在
    warnings = []
    for suffix in ("-wal", "-shm"):                 # 舊檔的輔助檔屬於舊內容，替換後不能留著
        p = Path(str(target_path) + suffix)
        try:
            if p.exists():
                p.unlink()
        except OSError as exc:
            warnings.append(f"無法刪除舊的 {p.name}（{exc}）；它屬於舊內容，請手動刪除後再使用備份檔")
    return saved, warnings
