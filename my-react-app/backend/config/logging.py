"""Django 與 FastAPI 共用的結構化 log 設定。

原本兩邊都只靠預設 logging（Django 完全沒有 LOGGING 設定、FastAPI 靠
uvicorn 預設的純文字 log），沒有 JSON 格式、也沒有 rotation，長時間跑
下去 log 檔案會無限增大。這裡提供一個共用的 dictConfig 產生器，兩邊各自
帶自己的檔名呼叫，統一輸出 JSON 格式並用 RotatingFileHandler 限制大小。
"""
import datetime
import json
import logging
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class JsonFormatter(logging.Formatter):
    """把每筆 log record 輸出成單行 JSON，方便集中蒐集／查詢。"""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.datetime.fromtimestamp(
                record.created, tz=datetime.timezone.utc
            ).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def get_logging_config(log_filename: str) -> dict:
    """回傳 logging.config.dictConfig 可吃的設定，log 檔寫到 LOG_DIR/log_filename，
    超過 LOG_MAX_BYTES 就 rotate，最多保留 LOG_BACKUP_COUNT 份舊檔。
    環境變數在呼叫當下才讀取（而非 import 當下），確保呼叫端先跑過
    load_dotenv() 的話一定讀得到 .env 裡的覆寫值。"""
    log_dir = os.getenv("LOG_DIR", os.path.join(BASE_DIR, "logs"))
    log_level = os.getenv("LOG_LEVEL", "INFO")
    log_max_bytes = int(os.getenv("LOG_MAX_BYTES", 10 * 1024 * 1024))
    log_backup_count = int(os.getenv("LOG_BACKUP_COUNT", 5))

    os.makedirs(log_dir, exist_ok=True)
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "json": {"()": f"{__name__}.JsonFormatter"},
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "json",
            },
            "file": {
                "class": "logging.handlers.RotatingFileHandler",
                "filename": os.path.join(log_dir, log_filename),
                "maxBytes": log_max_bytes,
                "backupCount": log_backup_count,
                "encoding": "utf-8",
                "formatter": "json",
            },
        },
        "root": {
            "handlers": ["console", "file"],
            "level": log_level,
        },
    }
