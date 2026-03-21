"""
Firebase 資料庫匯入腳本
執行前請先：
  1. 從 Firebase Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰
  2. 把下載的 JSON 改名為 serviceAccountKey.json，放在本腳本同一層資料夾
執行方式：python import_firebase.py
"""

import json
import os
import sys
import firebase_admin
from firebase_admin import credentials, firestore, auth

# ── 設定路徑 ──────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
KEY_FILE = os.path.join(BASE_DIR, "serviceAccountKey.json")
BACKUP_DIR = r"\\Mac\Home\Desktop\win\7.系統資料庫備份檔案"

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
print("\n── 建立 Authentication 帳號 ─────────────────────────")
print("⚠️  舊密碼 hash 無法移植到新專案，將用臨時密碼 'Test1234' 建立帳號")
print("   帳號建立後請自行至 Firebase Console 或應用程式修改密碼\n")

if not os.path.exists(AUTH_FILE):
    print(f"❌ 找不到：{AUTH_FILE}")
else:
    with open(AUTH_FILE, "r", encoding="utf-8") as f:
        users = json.load(f)

    for u in users:
        uid   = u["uid"]
        email = u["email"]
        try:
            auth.create_user(
                uid=uid,
                email=email,
                password="Test1234",
                email_verified=u.get("emailVerified", False),
                disabled=u.get("disabled", False),
            )
            print(f"  ✅ 建立帳號：{email}  (uid: {uid})")
        except auth.UidAlreadyExistsError:
            print(f"  ℹ️  已存在：{email}，略過")
        except auth.EmailAlreadyExistsError:
            print(f"  ℹ️  Email 已使用：{email}，略過")
        except Exception as e:
            print(f"  ❌ 失敗：{email} → {e}")

print("\n✅ 匯入完成！")
print("所有帳號的臨時密碼為：Test1234")
print("請提醒用戶登入後自行修改密碼。")
