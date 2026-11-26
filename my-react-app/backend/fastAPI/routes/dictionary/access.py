"""辭典唯讀查詢的身分判定：登入者照舊驗證，沒帶登入憑證的請求以「訪客」身分通過（稽核 FE3-01）。

單詞查詢頁（/search）本來就對訪客公開，但辭典 API 整組要求登入，訪客每次查詢都 401。
只開放唯讀、只回辭典公開資料的端點（見 search.public_router），其餘辭典端點仍掛 verify_firebase_token。

跟翻譯的 verify_firebase_token_or_guest 不同：查辭典不花錢（不呼叫付費 API），所以不需要伺服器核發的
訪客憑證與每日額度，只靠依 IP 的每分鐘限流（search.py 的 _member_or_guest_rate）擋濫用。
"""
from fastapi import Header, Request

from .. import auth


async def verify_firebase_token_or_anonymous(request: Request, authorization: str = Header(default=None)):
    """帶了 Authorization 就一律照原本驗證，失敗回 401，**不會降級成訪客**——否則 token 過期的
    登入者會悄悄改吃訪客的限流額度，看起來像系統變慢或被擋。

    訪客的 request.state.user 沒有 uid，rate_limit_key 因此退回用 IP 計數。"""
    if authorization or auth._auth_dev_bypass():
        return await auth.verify_firebase_token(request, authorization)
    user = {"uid": "", "guest": True}
    request.state.user = user
    return user
