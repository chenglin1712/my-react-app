"""
Firebase 資料庫匯入腳本
執行前請先：
  1. 從 Firebase Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰
  2. 把下載的 JSON 改名為 serviceAccountKey.json，放在本腳本同一層資料夾
     （這個檔名已列在 .gitignore，但仍建議操作時避免下 git add -A，改用
     git add 明確列出要加入的檔案，降低私鑰誤入版控的風險）
  3. 設定環境變數 FIREBASE_IMPORT_BACKUP_DIR，指向備份檔案所在資料夾
     （原本寫死一段本機路徑，換一台機器或換人操作就會找不到檔案）
執行方式：FIREBASE_IMPORT_BACKUP_DIR=/path/to/backup python import_firebase.py
"""

import datetime
import json
import os
import secrets
import sys
import firebase_admin
from firebase_admin import credentials, firestore, auth

# ── 設定路徑 ──────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
KEY_FILE = os.path.join(BASE_DIR, "serviceAccountKey.json")

BACKUP_DIR = os.environ.get("FIREBASE_IMPORT_BACKUP_DIR")
if not BACKUP_DIR:
    print("❌ 請先設定環境變數 FIREBASE_IMPORT_BACKUP_DIR，指向備份檔案所在資料夾")
    sys.exit(1)

FIRESTORE_FILES = {
    "users":         os.path.join(BACKUP_DIR, "firestore", "users.json"),
    "calendar":      os.path.join(BACKUP_DIR, "firestore", "calendar.json"),
    "quizs":         os.path.join(BACKUP_DIR, "firestore", "quizs.json"),
    "sharedNotes":   os.path.join(BACKUP_DIR, "firestore", "sharedNotes.json"),
    "userSituation": os.path.join(BACKUP_DIR, "firestore", "userSituation.json"),
    "situation":     os.path.join(BACKUP_DIR, "firestore", "situation.json"),
}

AUTH_FILE = os.path.join(BACKUP_DIR, "authentication", "auth.json")

# ── 初始化 Firebase Admin ─────────────────────────────────
if not os.path.exists(KEY_FILE):
    print(f"❌ 找不到服務帳號金鑰：{KEY_FILE}")
    print("請從 Firebase Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰")
    sys.exit(1)

cred = credentials.Certificate(KEY_FILE)
firebase_admin.initialize_app(cred)
db = firestore.client()
print("✅ Firebase 連線成功\n")

# ── 匯入 Firestore 資料 ───────────────────────────────────
def import_collection(collection_name, json_path):
    if not os.path.exists(json_path):
        print(f"  ⚠️  找不到檔案：{json_path}，略過")
        return

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if not data or data == [] or data == {}:
        print(f"  ⚠️  {collection_name} 資料為空，略過")
        return

    col_ref = db.collection(collection_name)
    count = 0
    for doc_id, doc_data in data.items():
        col_ref.document(doc_id).set(doc_data)
        count += 1

    print(f"  ✅ {collection_name}：匯入 {count} 筆")

print("── 匯入 Firestore 資料 ──────────────────────────────")
for col_name, file_path in FIRESTORE_FILES.items():
    import_collection(col_name, file_path)

# ── 建立測試帳號（因舊密碼 hash 無法移植，改用臨時密碼）─────
# 原本所有帳號共用同一組寫死的臨時密碼 "Test1234"：如果之後對正式專案重新
# 跑這支腳本，在使用者改密碼之前，任何人都能用「email + 這組公開已知的
# 密碼」登入任一帳號，等於帳號被接管。改成每個帳號各自產生一組不可預期的
# 隨機密碼，帳號之間互不相通，未改密碼前的風險只限於「知道這組密碼的人」
# （也就是執行這支腳本、看得到輸出的操作者本人），而不是任何人都能猜到。
print("\n── 建立 Authentication 帳號 ─────────────────────────")
print("⚠️  舊密碼 hash 無法移植到新專案，將為每個帳號各自產生一組隨機臨時密碼")
print("   請盡快把對應密碼轉交給各帳號使用者，並提醒登入後立即自行修改密碼\n")

# 臨時密碼改寫進獨立檔案、不印到 stdout：這支腳本的輸出常會被導向 log 檔或
# CI/操作紀錄留存，直接印明文密碼會讓密碼隨著那些輸出一起被留存下來。獨立檔案
# 才會包含密碼，檔名帶時間戳記避免覆蓋前一次執行的結果，且已被 .gitignore
# 排除（見下方 imported_credentials_*.txt 規則）。
CREDENTIALS_FILE = os.path.join(
    BASE_DIR, f"imported_credentials_{datetime.datetime.now():%Y%m%d_%H%M%S}.txt"
)

if not os.path.exists(AUTH_FILE):
    print(f"❌ 找不到：{AUTH_FILE}")
else:
    with open(AUTH_FILE, "r", encoding="utf-8") as f:
        users = json.load(f)

    credentials_lines = []
    for u in users:
        uid   = u["uid"]
        email = u["email"]
        temp_password = secrets.token_urlsafe(12)
        try:
            auth.create_user(
                uid=uid,
                email=email,
                password=temp_password,
                email_verified=u.get("emailVerified", False),
                disabled=u.get("disabled", False),
            )
            credentials_lines.append(f"{email}\t{uid}\t{temp_password}\n")
            print(f"  ✅ 建立帳號：{email}  (uid: {uid})")
        except auth.UidAlreadyExistsError:
            print(f"  ℹ️  已存在：{email}，略過")
        except auth.EmailAlreadyExistsError:
            print(f"  ℹ️  Email 已使用：{email}，略過")
        except Exception as e:
            print(f"  ❌ 失敗：{email} → {e}")

    if credentials_lines:
        with open(CREDENTIALS_FILE, "w", encoding="utf-8") as f:
            f.writelines(credentials_lines)
        print(f"\n⚠️  臨時密碼（明文）已寫入：{CREDENTIALS_FILE}")
        print("   請盡快逐一轉交給對應使用者後刪除此檔案，切勿提交進版控或留在他人可存取的地方。")

print("\n✅ 匯入完成！")
print("每個帳號的臨時密碼各自不同，請參考上面提到的憑證檔案逐一轉交給對應使用者。")
print("請提醒用戶登入後自行修改密碼。")
