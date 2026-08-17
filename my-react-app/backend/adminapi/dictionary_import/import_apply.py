"""核准套用批次匯入工作時，逐列真正寫入 dictionary_db 的邏輯——從
dictionary_import_views.import_job_approve() 抽出來，跟角色檢查／限流／
Django 端工作狀態機這些 HTTP 邊界關注點分開（P4 review BE-17）。"""
import logging
import uuid

from dictionary_db.connect import dictionary_write_session

from .. import dictionary_write as dw

logger = logging.getLogger(__name__)

# 批次匯入新建列的 deterministic id 用固定命名空間推導，同一個
# (job_id, row) 不管重跑幾次都會得到同一個 id——見 apply_import_job_rows()
# 逐列 checkpoint 的說明：這是「同一列重跑會對回同一筆詞條，而不是每次
# 建一筆新的」這個保證的根本，沒有這個就無法安全續跑 create 列。
_IMPORT_ROW_ID_NAMESPACE = uuid.UUID("f2e6b9d0-9b1a-4b7a-9f3a-6c2f6f9a7d31")


def _deterministic_import_row_id(job_pk, row):
    return str(uuid.uuid5(_IMPORT_ROW_ID_NAMESPACE, f"dictionary-import-job:{job_pk}:row:{row}"))


def apply_import_job_rows(job, fresh_report):
    """每一筆詞條各自開一個 dictionary_write_session()（見規劃文件 P4 §5
    「一筆詞條一個交易」）——Postgres 交易裡一旦有一筆出錯，同一個交易
    後續每一筆都會變成 current transaction is aborted，整批一個交易會
    導致「查出 3 個錯誤，0 筆成功套用，還得全部重跑」；逐筆交易讓錯誤
    互相隔離。除了 DictionaryWriteError（含 apply_word_tree 在鎖定目標列
    之後重新比對 current_hash 失敗的 ConcurrentModificationError）之外，
    也攔截任何非預期例外（例如底層 SQLAlchemy/DBAPI 錯誤）避免單一列的
    意外中斷整個迴圈、讓後面的列完全沒有機會套用。每處理完一列立刻把
    結果 checkpoint 回 Django（job.report／applied_count／failed_count），
    不是等整個迴圈跑完才一次寫入——process 中途被中斷，Django 端至少留著
    「處理到第幾筆」的真實記錄。新建列用 deterministic id（見
    _deterministic_import_row_id()），同一列如果需要重跑會對回同一筆詞條，
    不會重複建立。呼叫端（import_job_approve()）負責在呼叫這支函式之前
    把 job 狀態鎖定認領成 applying，這裡不處理狀態機轉換，只處理逐列套用
    與 checkpoint。"""
    applied_count = 0
    failed_count = 0
    outcomes = []
    for item in fresh_report["items"]:
        row = item["row"]
        if item["action"] == "error":
            outcome = {"row": row, "name": item["name"], "outcome": "skipped", "detail": item["errors"]}
        else:
            try:
                with dictionary_write_session() as write_db:
                    result_id = dw.apply_word_tree(
                        write_db, item["payload"], word_id=item["word_id"], expected_hash=item.get("current_hash"),
                        create_id=_deterministic_import_row_id(job.pk, row) if not item["word_id"] else None,
                    )
                applied_count += 1
                outcome = {"row": row, "name": item["name"], "outcome": "applied", "word_id": result_id}
            except dw.DictionaryWriteError as exc:
                failed_count += 1
                outcome = {"row": row, "name": item["name"], "outcome": "failed", "detail": str(exc)}
            except Exception:
                # 不是我們自己定義的 DictionaryWriteError——例如底層 SQLAlchemy/
                # DBAPI 例外。dictionary_write_session() 已經對這一筆的交易做了
                # rollback，不影響其他列；這裡只是不讓單一列的非預期例外中斷
                # 整個迴圈，也不把可能含內部細節的原始例外文字暴露出去。
                logger.exception("匯入套用第 %s 列時發生非預期例外", row)
                failed_count += 1
                outcome = {
                    "row": row, "name": item["name"], "outcome": "failed",
                    "detail": "套用時發生非預期錯誤，請查看伺服器日誌",
                }

        outcomes.append(outcome)
        # 逐列 checkpoint：每處理完一筆就立刻寫回 Django，而不是等整個
        # 迴圈跑完才一次寫入——見本函式 docstring 的說明。
        job.report = {**fresh_report, "outcomes": outcomes}
        job.applied_count = applied_count
        job.failed_count = failed_count
        job.save(update_fields=["report", "applied_count", "failed_count"])

    return applied_count, failed_count, outcomes
