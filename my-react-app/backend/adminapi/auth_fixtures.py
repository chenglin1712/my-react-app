"""測試用：幫「模擬後台登入」的 decoded token 補上最近的 auth_time。

後台的 require_role 現在會檢查 auth_time 新鮮度（見 core/firebase_auth.py）。真正的 Firebase ID token
一定帶有 auth_time，但各測試檔自己手寫的 decoded 字典通常只有 uid 與 role，這裡統一補上「剛剛驗證過」，
不用每個測試各寫一次。decoded 已經有 auth_time（例如專門測過期的案例）就原樣保留，不會被覆蓋。
"""
import time


def fresh_auth(decoded):
    if "auth_time" in decoded:
        return decoded
    return {**decoded, "auth_time": int(time.time())}
