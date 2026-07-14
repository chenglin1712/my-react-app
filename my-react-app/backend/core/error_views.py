"""全站統一的 JSON 錯誤回應。

這個 Django 專案底下所有掛載的 app（crawler、AIModel、CrosswordPuzzle）都是純
JSON API，沒有任何 HTML 頁面（admin 沒掛載、沒有前端 catch-all route）。但 Django
預設的 400/403/404/500 錯誤頁面是 HTML，任何一個 view 裡沒被自己的 try/except
接住的例外（畸形請求、未預期的例外等）最後都會變成一頁 HTML 噴回去，跟這個 API
其餘端點統一回 JSON 的約定不一致。這裡在 core/urls.py 註冊成 handler400/403/404/500，
當成所有 view 各自錯誤處理之外的最後一道防線，統一回應格式。

只有 DEBUG=False 時 Django 才會真的呼叫 handler500（DEBUG=True 時 Django 會顯示
互動式的除錯 traceback 頁面，這是本機開發需要的行為，不受這裡影響）。
"""
from django.http import JsonResponse


def json_400(request, exception=None):
    return JsonResponse({"detail": "請求格式錯誤"}, status=400)


def json_403(request, exception=None):
    return JsonResponse({"detail": "沒有權限執行此操作"}, status=403)


def json_404(request, exception=None):
    return JsonResponse({"detail": "找不到此資源"}, status=404)


def json_500(request):
    return JsonResponse({"detail": "伺服器發生錯誤，請稍後再試"}, status=500)
