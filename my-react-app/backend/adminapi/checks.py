"""部署前檢查（python manage.py check --deploy）。"""
import os

from django.core import checks


@checks.register(checks.Tags.security, deploy=True)
def cloudinary_cloud_name_is_set(app_configs, **kwargs):
    """專題圖片只收 res.cloudinary.com，但沒設 CLOUDINARY_CLOUD_NAME 時，任何 Cloudinary 帳號的圖片都會通過。

    刻意只給警告、不讓服務起不來：這個變數以前後端用不到，直接設為必要會讓既有部署啟動失敗。
    """
    if os.getenv("CLOUDINARY_CLOUD_NAME", "").strip():
        return []
    return [
        checks.Warning(
            "CLOUDINARY_CLOUD_NAME 未設定，本期專題的圖片網址驗證不會限制 Cloudinary 帳號。",
            hint="在後端環境變數設定與前端 VITE_CLOUDINARY_CLOUD_NAME 相同的值（env 變更不需要新金鑰）。",
            id="adminapi.W001",
        )
    ]
