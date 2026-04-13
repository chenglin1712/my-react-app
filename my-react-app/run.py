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
sys.path.append(os.path.join(BASE_DIR, "backend"))

load_dotenv(os.path.join(BASE_DIR, ".env"))

# ── 啟動前環境變數檢查 ──────────────────────────────────────────
REQUIRED_VARS = {
    "GITHUB_TOKEN": "GitHub Models API Token（AI 對話功能）",
    "DJANGO_SECRET_KEY": "Django 安全金鑰",
}
OPTIONAL_VARS = {
    "VITE_CLOUD_API_KEY": "Google Cloud Vision API 金鑰（影像辨識，未設定時該功能不可用）",
    "VITE_AUDIO_FILE_URL": "音檔 API URL（語音比對，未設定時該功能不可用）",
}

missing_required = [
    f"  - {var}：{desc}"
    for var, desc in REQUIRED_VARS.items()
    if not os.getenv(var)
]
missing_optional = [
    f"  - {var}：{desc}"
    for var, desc in OPTIONAL_VARS.items()
    if not os.getenv(var)
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
    uvicorn.run(
        "core.asgi:application",
        host="127.0.0.1",
        port=8000,
        reload=False
    )
