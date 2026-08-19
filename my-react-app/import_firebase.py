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

# Windows 終端機預設不是 UTF-8（cp1252），這支腳本的輸出全是中文，不
# reconfigure 會在印出中文字時直接丟 UnicodeEncodeError 中斷腳本——跟
# run.py／run_fastapi.py／management commands 同一個既有問題與既有處理方式。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

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
    # collection 名稱是 "situations"（複數）——全站唯一實際讀寫這份資料的地方
    # （firestore.rules 的 match /situations/{situationId}、
    # frontend/src/userServives/uploadDb.jsx 的 collection(db, "situations")）
    # 都是複數。這裡原本寫成單數 "situation"，會把備份資料匯入一個沒有任何
    # 程式碼讀取的孤兒 collection，真正的 situations collection 從未被還原
    # （獨立審查找到的問題）。備份檔案本身仍叫 situation.json，那是備份工具
    # 當初的命名，不是 Firestore collection 名稱，不需要跟著改。
    "situations":    os.path.join(BACKUP_DIR, "firestore", "situation.json"),
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

# ── 還原被 JSON 序列化壓扁的 Firestore 型別 ─────────────────
# JSON 沒有 Timestamp 型別，備份檔案裡的時間戳記顯然是某個匯出流程用類似
# `default=lambda o: {"_seconds": o.timestamp(), "_nanoseconds": ...}` 的
# 方式序列化出來的——json.load() 讀回來之後，這些欄位只是長得像 Timestamp
# 的普通 dict，不是真正的 Timestamp。原本這裡直接把整份 dict 原封不動
# `.set()` 回 Firestore，寫進去的就真的是一個巢狀 map，不是 Timestamp
# 型別，這正是正式資料裡 sharedNotes.createdAt 變成
# `{"_seconds":…, "_nanoseconds":…}`、讀取端顯示「NaN 天前」、
# `orderBy("createdAt")` 排序完全錯亂的根因（獨立審查找到的問題，見
# frontend/src/_note/timeAgo.js 的對應修正）。
#
# 遞迴走訪每一筆文件資料，把「形狀恰好是 {_seconds, _nanoseconds}（且沒有
# 其他 key）」的 dict 還原成 timezone-aware 的 datetime——Firestore Admin
# SDK 的 Python client 看到 datetime.datetime 值會自動存成原生 Timestamp
# 型別，不需要另外呼叫任何轉換函式。
#
# 型別檢查刻意比「isinstance(x, (int, float))」更嚴格（獨立審查覆核這批
# 修正時找到的問題）：
#   - bool 是 int 的子類別，isinstance(True, int) 會是 True，
#     一個湊巧只有這兩個 key、值恰好是 True/False 的業務資料會被誤判成時間；
#   - 只接受 int，不接受 float：真正的 Firestore Timestamp 序列化出來的
#     _seconds/_nanoseconds 本來就是整數，float 代表這份資料的來源不是
#     Timestamp 序列化，繼續轉換只會產生不必要的捨入誤差；
#   - nanoseconds 限制在 [0, 1_000_000_000) 這個合法範圍內，超出範圍代表
#     語意上不是真正的 Timestamp 分量。
# 轉換本身也可能因為 seconds 数值超出 datetime 支援的範圍而丟
# OverflowError／OSError／ValueError——這種情況代表這個 dict 終究不是一個
# 合法的時間戳記，安全地當成一般資料原樣保留（遞迴進去逐 key 處理），不要
# 讓一筆資料的異常值中斷整個匯入流程。
def _is_timestamp_map(value):
    if not isinstance(value, dict) or set(value.keys()) != {"_seconds", "_nanoseconds"}:
        return False
    seconds = value["_seconds"]
    nanoseconds = value["_nanoseconds"]
    if isinstance(seconds, bool) or isinstance(nanoseconds, bool):
        return False
    if not isinstance(seconds, int) or not isinstance(nanoseconds, int):
        return False
    return 0 <= nanoseconds < 1_000_000_000


def _restore_timestamps(value):
    if isinstance(value, dict):
        if _is_timestamp_map(value):
            try:
                return datetime.datetime.fromtimestamp(
                    value["_seconds"] + value["_nanoseconds"] / 1e9, tz=datetime.timezone.utc,
                )
            except (OverflowError, OSError, ValueError):
                print(f"  ⚠️  {value} 長得像 timestamp map 但數值超出合理範圍，保留原始值")
        return {key: _restore_timestamps(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_restore_timestamps(item) for item in value]
    return value


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
        col_ref.document(doc_id).set(_restore_timestamps(doc_data))
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
