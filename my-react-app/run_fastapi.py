import os
import sys
import uvicorn
from dotenv import load_dotenv

# Windows 上強制使用 UTF-8 避免中文編碼錯誤
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')
if sys.stderr.encoding != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
# 確保 backend 目錄排在最前面，reload subprocess 也能找到模組
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)
os.environ["PYTHONPATH"] = BACKEND_DIR + os.pathsep + os.environ.get("PYTHONPATH", "")

load_dotenv(os.path.join(BASE_DIR, ".env"))

# ── 啟動前環境變數檢查 ──────────────────────────────────────────
REQUIRED_VARS = {
    "CLOUD_API_KEY": "Google Cloud Vision API 金鑰（影像辨識功能）",
    "CLOUD_API_URL": "Google Cloud Vision API URL",
}
OPTIONAL_VARS = {
    "FFMPEG_PATH": "ffmpeg 路徑（語音比對功能，若系統 PATH 已有 ffmpeg 可省略）",
}

missing_required = [
    f"  - {var}：{desc}"
    for var, desc in REQUIRED_VARS.items()
    if not os.getenv(var)
]
missing_optional = [
    f"  - {var}：{desc}"
    for var, desc in OPTIONAL_VARS.items()
    if not os.getenv(var) and not __import__('shutil').which('ffmpeg')
]

if missing_optional:
    print("[警告] 以下選用環境變數未設定，部分功能將無法使用：")
    print("\n".join(missing_optional))

if missing_required:
    print("[錯誤] 以下必要環境變數未設定，伺服器無法正常啟動：")
    print("\n".join(missing_required))
    print("\n請複製 .env.example 為 .env 並填入對應值，參考說明如下：")
    print("  cp .env.example .env")
    sys.exit(1)
# ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # fastAPI.main 匯入時就會自己套用 config/logging.py 的 JSON + rotation 設定
    # （不再只靠這支開發用啟動腳本手動呼叫，正式環境直接用 uvicorn 啟動也會套用）。
    from fastAPI.main import app  # noqa: E402  直接 import，不依賴 reload subprocess 重新解析路徑
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8001,
        log_config=None,  # 不用 uvicorn 內建的純文字 log 設定，改用 fastAPI.main 已套用的 JSON + rotation
    )
