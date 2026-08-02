"""測試 config/auth_flags.py 與 config/firebase_auth.py：這波稽核指出 DEBUG／
AUTH_DEV_BYPASS 互鎖邏輯是全站認證最關鍵的一段判斷，卻沒有專屬測試檔案，只靠
其他 app 的測試間接覆蓋到（等於「有沒有真的鎖住」從來沒被直接驗證過）。
"""
from unittest.mock import patch

from django.http import JsonResponse
from django.test import TestCase, override_settings

from config.auth_flags import auth_dev_bypass
from config.firebase_auth import require_role, verify_firebase_token
from config.roles import ADMIN, EDITOR, OWNER, STAFF_ROLES
from config.tribes import resolve_tribe_name


class ResolveTribeNameTest(TestCase):
    """config/tribes.py 的 resolve_tribe_name()：這波稽核發現多個 dictionary 端點
    用 TRIBE_MAP.get(tribe, 某個預設值) 這種「查無則吃預設值」的寫法解析族語參數，
    導致打錯字或帶入不支援的族語時，會靜默回傳（甚至是錯部落的）資料而非報錯。
    """

    def test_accepts_slug(self):
        self.assertEqual(resolve_tribe_name("tayal"), "泰雅語")

    def test_accepts_short_name(self):
        self.assertEqual(resolve_tribe_name("泰雅"), "泰雅語")

    def test_accepts_full_name_passthrough(self):
        # grammar.py 原本的 fallback 行為（TRIBE_MAP.get(tribe, tribe)）會讓直接
        # 傳全名的呼叫命中，這裡維持相容，不能因為這次修正而擋掉原本能動的用法。
        self.assertEqual(resolve_tribe_name("泰雅語"), "泰雅語")

    def test_accepts_kavalan_alias(self):
        self.assertEqual(resolve_tribe_name("噶瑪蘭"), resolve_tribe_name("葛瑪蘭"))

    def test_rejects_unsupported_value(self):
        with self.assertRaises(ValueError):
            resolve_tribe_name("這不是一個族語")

    def test_rejects_empty_string(self):
        with self.assertRaises(ValueError):
            resolve_tribe_name("")


class AuthDevBypassTest(TestCase):
    """auth_dev_bypass() 本身：Django／FastAPI 共用同一份互鎖邏輯。"""

    def test_both_flags_true_bypasses(self):
        with patch.dict("os.environ", {"DJANGO_DEBUG": "True", "AUTH_DEV_BYPASS": "True"}):
            self.assertTrue(auth_dev_bypass())

    def test_debug_false_never_bypasses_even_if_flag_true(self):
        # 正式環境若誤設 AUTH_DEV_BYPASS=True 但 DJANGO_DEBUG=False，仍要求驗證。
        with patch.dict("os.environ", {"DJANGO_DEBUG": "False", "AUTH_DEV_BYPASS": "True"}):
            self.assertFalse(auth_dev_bypass())

    def test_flag_false_does_not_bypass_even_if_debug_true(self):
        with patch.dict("os.environ", {"DJANGO_DEBUG": "True", "AUTH_DEV_BYPASS": "False"}):
            self.assertFalse(auth_dev_bypass())

    def test_both_flags_false(self):
        with patch.dict("os.environ", {"DJANGO_DEBUG": "False", "AUTH_DEV_BYPASS": "False"}):
            self.assertFalse(auth_dev_bypass())

    def test_service_specific_override_takes_priority_when_set(self):
        # FastAPI 可以額外設定 FASTAPI_AUTH_DEV_BYPASS，明確設定時蓋過共用的
        # AUTH_DEV_BYPASS——本機開發只想讓 Django bypass、FastAPI 仍走真實驗證。
        with patch.dict(
            "os.environ",
            {"DJANGO_DEBUG": "True", "AUTH_DEV_BYPASS": "True", "FASTAPI_AUTH_DEV_BYPASS": "False"},
        ):
            self.assertFalse(auth_dev_bypass("FASTAPI_AUTH_DEV_BYPASS"))
            self.assertTrue(auth_dev_bypass())  # Django（共用旗標）不受影響

    def test_service_specific_override_falls_back_to_shared_flag_when_unset(self):
        with patch.dict("os.environ", {"DJANGO_DEBUG": "True", "AUTH_DEV_BYPASS": "True"}, clear=False):
            import os as _os
            _os.environ.pop("FASTAPI_AUTH_DEV_BYPASS", None)
            self.assertTrue(auth_dev_bypass("FASTAPI_AUTH_DEV_BYPASS"))


class _FakeRequest:
    def __init__(self, auth_header=None):
        self.META = {}
        if auth_header is not None:
            self.META["HTTP_AUTHORIZATION"] = auth_header


class VerifyFirebaseTokenTest(TestCase):
    """config/firebase_auth.py 的 verify_firebase_token：Django 端消費
    auth_dev_bypass() 之後的實際行為（django_settings.AUTH_DEV_BYPASS 是
    settings.py 載入當下就算好的值，用 override_settings 直接覆蓋來測）。
    """

    @override_settings(AUTH_DEV_BYPASS=True)
    def test_dev_bypass_skips_verification(self):
        # dev bypass 現在會附帶一個角色（預設 owner，見 require_role 之後新增的
        # AUTH_DEV_BYPASS_ROLE），讓本機開發不用先設定 Firebase custom claim
        # 就能直接測後台管理系統；沒設定 AUTH_DEV_BYPASS_ROLE 環境變數時預設 owner。
        decoded, error = verify_firebase_token(_FakeRequest())
        self.assertEqual(decoded, {"uid": "dev-user", "role": "owner"})
        self.assertIsNone(error)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_missing_authorization_header_rejected(self):
        decoded, error = verify_firebase_token(_FakeRequest())
        self.assertIsNone(decoded)
        self.assertIsInstance(error, JsonResponse)
        self.assertEqual(error.status_code, 401)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_non_bearer_header_rejected(self):
        decoded, error = verify_firebase_token(_FakeRequest(auth_header="Basic xyz"))
        self.assertIsNone(decoded)
        self.assertEqual(error.status_code, 401)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_valid_token_returns_decoded_claims(self):
        with patch("config.firebase_auth.ensure_firebase_initialized"):
            with patch("firebase_admin.auth.verify_id_token", return_value={"uid": "real-user"}):
                decoded, error = verify_firebase_token(_FakeRequest(auth_header="Bearer sometoken"))
        self.assertEqual(decoded, {"uid": "real-user"})
        self.assertIsNone(error)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_invalid_token_returns_401_without_logging(self):
        # 單一使用者 token 過期／被撤銷是正常流量，不應該被記成 error log。
        import firebase_admin.auth as fa

        with patch("config.firebase_auth.ensure_firebase_initialized"):
            with patch("firebase_admin.auth.verify_id_token", side_effect=fa.ExpiredIdTokenError("expired", cause=None)):
                with patch("config.firebase_auth.logger") as mock_logger:
                    decoded, error = verify_firebase_token(_FakeRequest(auth_header="Bearer badtoken"))
        self.assertIsNone(decoded)
        self.assertEqual(error.status_code, 401)
        mock_logger.exception.assert_not_called()

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_unexpected_exception_returns_401_and_logs(self):
        # 這是本輪修正的重點：非 InvalidIdTokenError 的例外（憑證抓取失敗等）
        # 代表驗證機制本身可能整個掛掉，必須被記錄下來才能讓 Sentry 告警。
        with patch("config.firebase_auth.ensure_firebase_initialized"):
            with patch("firebase_admin.auth.verify_id_token", side_effect=RuntimeError("boom")):
                with patch("config.firebase_auth.logger") as mock_logger:
                    decoded, error = verify_firebase_token(_FakeRequest(auth_header="Bearer sometoken"))
        self.assertIsNone(decoded)
        self.assertEqual(error.status_code, 401)
        mock_logger.exception.assert_called_once()

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_missing_service_account_returns_503_and_logs(self):
        with patch(
            "config.firebase_auth.ensure_firebase_initialized",
            side_effect=EnvironmentError("FIREBASE_SERVICE_ACCOUNT_PATH 未設定"),
        ):
            with patch("config.firebase_auth.logger") as mock_logger:
                decoded, error = verify_firebase_token(_FakeRequest(auth_header="Bearer sometoken"))
        self.assertIsNone(decoded)
        self.assertEqual(error.status_code, 503)
        mock_logger.error.assert_called_once()

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_malformed_service_account_returns_503_instead_of_crashing(self):
        # 回歸測試：ensure_firebase_initialized() 丟出的若不是 EnvironmentError
        # （例如服務帳戶金鑰檔案存在但格式損毀，firebase_admin.credentials.Certificate
        # 會丟 ValueError），原本的寫法會在比對 `except firebase_auth.InvalidIdTokenError`
        # 這個子句時，因為 firebase_auth 這個名字（本該在 try 區塊內 import）根本還沒被
        # 賦值,直接讓 UnboundLocalError 往外拋，不會被任何 except 接住。
        with patch(
            "config.firebase_auth.ensure_firebase_initialized",
            side_effect=ValueError("Invalid certificate"),
        ):
            with patch("config.firebase_auth.logger") as mock_logger:
                decoded, error = verify_firebase_token(_FakeRequest(auth_header="Bearer sometoken"))
        self.assertIsNone(decoded)
        self.assertEqual(error.status_code, 503)
        mock_logger.exception.assert_called_once()


class RequireRoleTest(TestCase):
    """config/firebase_auth.py 的 require_role：後台管理系統每一支 API 都要靠
    這個函式擋權限，所以特別驗證「沒登入」「登入但角色不夠」「角色剛好在清單內」
    「dev bypass 也一樣要吃角色限制」這四種情況分別回什麼。
    """

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_not_logged_in_returns_verify_firebase_token_error_unchanged(self):
        # 沒登入時應該直接拿到 verify_firebase_token 原本的 401，不能被角色檢查
        # 蓋成別的錯誤——呼叫端才能用同一套邏輯判斷「未登入」，不用另外處理。
        decoded, error = require_role(_FakeRequest(), STAFF_ROLES)
        self.assertIsNone(decoded)
        self.assertEqual(error.status_code, 401)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_role_in_allowed_list_passes_through_decoded_token(self):
        with patch("config.firebase_auth.ensure_firebase_initialized"):
            with patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u1", "role": ADMIN}):
                decoded, error = require_role(_FakeRequest(auth_header="Bearer t"), (OWNER, ADMIN))
        self.assertEqual(decoded, {"uid": "u1", "role": ADMIN})
        self.assertIsNone(error)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_role_not_in_allowed_list_returns_403(self):
        with patch("config.firebase_auth.ensure_firebase_initialized"):
            with patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u1", "role": EDITOR}):
                decoded, error = require_role(_FakeRequest(auth_header="Bearer t"), (OWNER, ADMIN))
        self.assertIsNone(decoded)
        self.assertEqual(error.status_code, 403)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_learner_without_role_claim_returns_403(self):
        # 一般學習者帳號沒有 role claim，decoded.get("role") 會是 None，
        # 必須被擋在任何非空的 allowed_roles 清單外，不能因為「沒有這個 key」
        # 就意外通過 in 判斷。
        with patch("config.firebase_auth.ensure_firebase_initialized"):
            with patch("firebase_admin.auth.verify_id_token", return_value={"uid": "learner-1"}):
                decoded, error = require_role(_FakeRequest(auth_header="Bearer t"), STAFF_ROLES)
        self.assertIsNone(decoded)
        self.assertEqual(error.status_code, 403)

    @override_settings(AUTH_DEV_BYPASS=True)
    def test_dev_bypass_still_enforces_allowed_roles(self):
        # dev bypass 預設扮演 owner，但這不代表角色檢查本身被繞過——如果呼叫端
        # 把允許清單縮小到不含 owner，dev bypass 一樣要被擋下，確保「免登入」
        # 跟「略過角色檢查」是兩件獨立的事，不會因為本機開發模式而混在一起。
        decoded, error = require_role(_FakeRequest(), (EDITOR,))
        self.assertIsNone(decoded)
        self.assertEqual(error.status_code, 403)
