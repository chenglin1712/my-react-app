"""把指定 email 的 Firebase 帳號標成後台角色（寫入 custom claims）。

用法：
    python manage.py set_staff_role 12130340@me.mcu.edu.tw --role owner

這是規劃文件 §1.1 提到的「Phase 0 第一支要跑的腳本」：在 §3.6 使用者管理
的角色指派 UI 做出來之前，唯一能把某個 Firebase 帳號標成後台角色的方式。
需要 FIREBASE_SERVICE_ACCOUNT_PATH 已設定並指向有效的服務帳戶金鑰。

角色變更後，這個帳號手上還沒過期的舊 ID token（最長 1 小時）不會立刻反映
新角色——見規劃文件 §1.1／§8 風險 5，這是已知、可接受的延遲，不在這支腳本
處理；如需立即生效，使用者自行登出重新登入即可換到帶新 claim 的 token。
"""
from django.core.management.base import BaseCommand, CommandError

from config.firebase_init import ensure_firebase_initialized
from config.roles import STAFF_ROLES


class Command(BaseCommand):
    help = "把指定 email 的 Firebase 帳號標成後台角色（寫入 custom claims 的 role 欄位）"

    def add_arguments(self, parser):
        parser.add_argument("email", help="Firebase 帳號的 email")
        parser.add_argument(
            "--role",
            default="owner",
            choices=STAFF_ROLES,
            help=f"要指派的角色，預設 owner。可用值：{', '.join(STAFF_ROLES)}",
        )

    def handle(self, *args, **options):
        email = options["email"]
        role = options["role"]

        try:
            ensure_firebase_initialized()
        except EnvironmentError as e:
            raise CommandError(str(e))

        from firebase_admin import auth as firebase_auth

        try:
            user = firebase_auth.get_user_by_email(email)
        except firebase_auth.UserNotFoundError:
            raise CommandError(f"找不到帳號：{email}（請確認這個 email 已經透過前台 /register 註冊過）")

        # 保留這個帳號既有的其他 custom claims（目前系統只用到 role，但用
        # merge 而不是整包覆蓋，避免以後多了其他 claim 時被這支腳本意外清空。
        existing_claims = dict(user.custom_claims or {})
        existing_role = existing_claims.get("role")
        existing_claims["role"] = role
        firebase_auth.set_custom_user_claims(user.uid, existing_claims)

        if existing_role == role:
            self.stdout.write(self.style.SUCCESS(
                f"{email}（uid: {user.uid}）已經是 {role}，無需變更"
            ))
        else:
            self.stdout.write(self.style.SUCCESS(
                f"已將 {email}（uid: {user.uid}）的角色從 {existing_role or '（無）'} 設為 {role}"
            ))
        self.stdout.write("此帳號需要重新登入（或等現有 token 最長 1 小時後自然過期）才會拿到帶新角色的 token。")
