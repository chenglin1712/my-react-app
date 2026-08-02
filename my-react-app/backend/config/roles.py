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

# 可以新增／編輯內容（公告等一般內容）的角色。reviewer 在權限矩陣裡是
# 「僅可留審查意見」，不算能編輯內容本身，所以不含在這裡。
CONTENT_EDITORS = (OWNER, ADMIN, EDITOR)

# 可以核准／發布內容的角色。editor 可編輯與送審，但不能核准自己送出的內容
# （見規劃文件 §1.2 權限矩陣，核准發布欄 editor 是 ❌）；reviewer 只能核准
# 辭典與題庫這類「限內容」的審定，個別內容類型的細節限制交給呼叫端自行判斷，
# 不在這個共用常數裡硬編碼。
CONTENT_APPROVERS = (OWNER, ADMIN, REVIEWER)

# 可以核准／發布「一般內容」（公告、首頁版位這類非辭典/題庫審定範圍）的角色。
# reviewer 的核准權限限定在辭典與題庫（見 CONTENT_APPROVERS 的說明），公告
# 不屬於那個「限內容」範圍，所以只有 owner／admin，跟 ACCOUNT_MANAGERS 剛好
# 同一組角色但語意不同（一個是能不能管別人的帳號，一個是能不能核准內容），
# 故意分開命名避免呼叫端看代碼誤解成在做帳號管理判斷。
PUBLISHERS = (OWNER, ADMIN)
