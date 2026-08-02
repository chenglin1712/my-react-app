"""後台管理系統的角色定義。

集中放在這裡讓 Django 端（config/firebase_auth.py）與未來的 FastAPI 端共用
同一份角色字串，避免兩邊各自寫死一份、拼字或清單對不上時權限判斷悄悄失效。
角色本身透過 Firebase custom claims 寫入 ID token（見規劃文件 §1.1），這裡
只定義角色名稱常數與幾個常用的角色群組，不含任何驗證邏輯。
"""

OWNER = "owner"
ADMIN = "admin"
EDITOR = "editor"
REVIEWER = "reviewer"
ANALYST = "analyst"

# 所有能進後台的角色（一般使用者沒有 role claim，不在這份清單內）
STAFF_ROLES = (OWNER, ADMIN, EDITOR, REVIEWER, ANALYST)

# 可以指派/收回他人角色的角色——刻意只有 owner，避免 admin 把自己或別人
# 拉到跟 owner 同等級（見規劃文件 §1.2 權限矩陣）。
ROLE_ASSIGNERS = (OWNER,)

# 可以管理「使用者帳號」（前台學習者）與「管理者帳號」（後台工作人員）的角色。
ACCOUNT_MANAGERS = (OWNER, ADMIN)

# 可以核准／發布內容的角色。editor 可編輯與送審，但不能核准自己送出的內容
# （見規劃文件 §1.2 權限矩陣，核准發布欄 editor 是 ❌）；reviewer 只能核准
# 辭典與題庫這類「限內容」的審定，個別內容類型的細節限制交給呼叫端自行判斷，
# 不在這個共用常數裡硬編碼。
CONTENT_APPROVERS = (OWNER, ADMIN, REVIEWER)
