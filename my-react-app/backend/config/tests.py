"""測試 config/auth_flags.py 與 config/firebase_auth.py：這波稽核指出 DEBUG／
AUTH_DEV_BYPASS 互鎖邏輯是全站認證最關鍵的一段判斷，卻沒有專屬測試檔案，只靠
其他 app 的測試間接覆蓋到（等於「有沒有真的鎖住」從來沒被直接驗證過）。
"""
from unittest.mock import patch

from django.http import JsonResponse
from django.test import TestCase, override_settings

from config.auth_flags import auth_dev_bypass
from config.firebase_auth import verify_firebase_token


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
        decoded, error = verify_firebase_token(_FakeRequest())
        self.assertEqual(decoded, {"uid": "dev-user"})
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
