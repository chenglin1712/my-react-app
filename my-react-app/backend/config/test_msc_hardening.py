"""稽核 MSC-1~MSC-4 的加固：撤銷檢查、必填角色、DEV_BYPASS 啟動斷言、輸入大小與跳脫。"""
import io
import json
from unittest.mock import MagicMock, patch

from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import RequestFactory, SimpleTestCase, TestCase
from django.test.utils import override_settings

from config.auth_flags import dev_bypass_exposure_problem


class TryVerifyChecksRevocationTests(SimpleTestCase):
    """MSC-1：匿名事件端點用的 try_verify_firebase_token 也要檢查撤銷與停權。"""

    def _request(self):
        return RequestFactory().post("/x", HTTP_AUTHORIZATION="Bearer tok")

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_verifies_with_check_revoked(self):
        from core.firebase_auth import try_verify_firebase_token

        with patch("core.firebase_auth.ensure_firebase_initialized"), \
                patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u1"}) as verify:
            self.assertEqual(try_verify_firebase_token(self._request()), "u1")
        verify.assert_called_once_with("tok", check_revoked=True)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_a_revoked_or_disabled_token_is_treated_as_anonymous(self):
        from firebase_admin import auth as firebase_auth

        from core.firebase_auth import try_verify_firebase_token

        for exc in (firebase_auth.RevokedIdTokenError("revoked"), firebase_auth.UserDisabledError("disabled")):
            with self.subTest(exc=type(exc).__name__), patch("core.firebase_auth.ensure_firebase_initialized"), \
                    patch("firebase_admin.auth.verify_id_token", side_effect=exc):
                self.assertIsNone(try_verify_firebase_token(self._request()))


class SetStaffRoleRequiresRoleTests(SimpleTestCase):
    """MSC-2：省略 --role 不再預設授予 owner。"""

    def test_omitting_role_is_an_error_and_touches_nothing(self):
        with patch("adminapi.management.commands.set_staff_role.ensure_firebase_initialized") as init, \
                patch("firebase_admin.auth.get_user_by_email") as lookup:
            with self.assertRaises(CommandError) as ctx:
                call_command("set_staff_role", "someone@example.com", stdout=io.StringIO(), stderr=io.StringIO())
        self.assertIn("--role", str(ctx.exception))
        init.assert_not_called()
        lookup.assert_not_called()

    def test_an_explicit_role_still_works(self):
        user = MagicMock(uid="u1", custom_claims={})
        with patch("adminapi.management.commands.set_staff_role.ensure_firebase_initialized"), \
                patch("firebase_admin.auth.get_user_by_email", return_value=user), \
                patch("firebase_admin.auth.set_custom_user_claims") as set_claims:
            call_command("set_staff_role", "someone@example.com", "--role", "admin", stdout=io.StringIO())
        set_claims.assert_called_once_with("u1", {"role": "admin"})

    def test_an_unknown_role_is_still_refused(self):
        with self.assertRaises(CommandError):
            call_command("set_staff_role", "someone@example.com", "--role", "superuser", stdout=io.StringIO(), stderr=io.StringIO())


class DevBypassExposureTests(SimpleTestCase):
    """MSC-3：AUTH_DEV_BYPASS 為真時，設定看起來可能被本機以外的人連到就拒絕啟動。"""

    LOCAL = ["localhost", "127.0.0.1"]

    def test_default_local_hosts_are_fine(self):
        self.assertIsNone(dev_bypass_exposure_problem(self.LOCAL, ["manage.py", "test"]))
        self.assertIsNone(dev_bypass_exposure_problem(self.LOCAL + ["::1", "[::1]"], []))

    def test_any_non_loopback_allowed_host_is_refused(self):
        for host in ("example.com", "*", ".example.com", "10.0.0.5", "0.0.0.0", "app.onrender.com"):
            with self.subTest(host=host):
                problem = dev_bypass_exposure_problem(self.LOCAL + [host], [])
                self.assertIsNotNone(problem)
                self.assertIn(host, problem)

    def test_runserver_bound_outside_loopback_is_refused(self):
        for addr in ("0.0.0.0:8000", "0:8000", "192.168.1.5:8000", "example.com:8000", "0.0.0.0"):
            with self.subTest(addr=addr):
                self.assertIsNotNone(dev_bypass_exposure_problem(self.LOCAL, ["manage.py", "runserver", addr]))

    def test_runserver_on_loopback_or_default_is_fine(self):
        for argv in (["manage.py", "runserver"], ["manage.py", "runserver", "8000"], ["manage.py", "runserver", "127.0.0.1:8000"],
                     ["manage.py", "runserver", "localhost:9000"], ["manage.py", "runserver", "[::1]:8000"],
                     ["manage.py", "runserver", "--noreload", "8001"]):
            with self.subTest(argv=argv):
                self.assertIsNone(dev_bypass_exposure_problem(self.LOCAL, argv))

    def test_gunicorn_bind_outside_loopback_is_refused(self):
        for argv in (["gunicorn", "core.wsgi:application", "--bind", "0.0.0.0:8000"],
                     ["gunicorn", "core.wsgi:application", "--bind=0.0.0.0:8000"],
                     ["gunicorn", "-b", "0.0.0.0:8000", "core.wsgi:application"]):
            with self.subTest(argv=argv):
                self.assertIsNotNone(dev_bypass_exposure_problem(self.LOCAL, argv))
        self.assertIsNone(dev_bypass_exposure_problem(self.LOCAL, ["gunicorn", "core.wsgi:application", "--bind", "127.0.0.1:8000"]))

    def test_gunicorn_cmd_args_environment_variable_is_checked_too(self):
        argv = ["gunicorn", "core.wsgi:application"]
        with patch.dict("os.environ", {"GUNICORN_CMD_ARGS": "--workers 3 --bind 0.0.0.0:8000"}):
            self.assertIsNotNone(dev_bypass_exposure_problem(self.LOCAL, argv))
        with patch.dict("os.environ", {"GUNICORN_CMD_ARGS": "--workers 3 --bind=127.0.0.1:8000"}):
            self.assertIsNone(dev_bypass_exposure_problem(self.LOCAL, argv))
        with patch.dict("os.environ", {"GUNICORN_CMD_ARGS": "--bind \"unterminated"}):
            try:
                dev_bypass_exposure_problem(self.LOCAL, argv)
            except ValueError:
                self.fail("無法解析的 GUNICORN_CMD_ARGS 不該讓檢查本身丟例外")

    def test_wildcard_and_lookalike_hosts_are_not_loopback(self):
        for host in ("0", "::", "[::]", "localhost.evil.com", "evil-localhost", "127.1", "localhost."):
            with self.subTest(host=host):
                self.assertIsNotNone(dev_bypass_exposure_problem(self.LOCAL + [host], []))
        for host in ("LOCALHOST", "127.0.0.2", "::1", "[::1]"):
            with self.subTest(host=host):
                self.assertIsNone(dev_bypass_exposure_problem(self.LOCAL + [host], []))

    def test_the_escape_hatch_never_relaxes_a_wildcard_allowed_host(self):
        argv = ["gunicorn", "core.wsgi:application", "--bind", "0.0.0.0:8000"]
        self.assertIsNotNone(dev_bypass_exposure_problem(["*"], argv, allow_nonloopback_bind=True))

    def test_the_container_escape_hatch_only_covers_the_bind_address(self):
        argv = ["gunicorn", "core.wsgi:application", "--bind", "0.0.0.0:8000"]
        self.assertIsNone(dev_bypass_exposure_problem(self.LOCAL, argv, allow_nonloopback_bind=True))
        self.assertIsNotNone(dev_bypass_exposure_problem(self.LOCAL + ["example.com"], argv, allow_nonloopback_bind=True))

    def test_settings_refuse_to_load_with_bypass_and_a_public_host(self):
        import importlib
        import os

        from core import settings as settings_module

        env = {"DJANGO_DEBUG": "True", "AUTH_DEV_BYPASS": "True", "DJANGO_ALLOWED_HOSTS": "app.example.com"}
        with patch.dict(os.environ, env):
            with self.assertRaises(ImproperlyConfigured) as ctx:
                importlib.reload(settings_module)
        self.assertIn("app.example.com", str(ctx.exception))
        importlib.reload(settings_module)          # 還原成目前環境的設定

    def test_settings_load_normally_with_bypass_on_local_hosts(self):
        import importlib
        import os

        from core import settings as settings_module

        with patch.dict(os.environ, {"DJANGO_DEBUG": "True", "AUTH_DEV_BYPASS": "True"}):
            os.environ.pop("DJANGO_ALLOWED_HOSTS", None)
            os.environ.pop("RENDER_EXTERNAL_HOSTNAME", None)
            reloaded = importlib.reload(settings_module)
            self.assertTrue(reloaded.AUTH_DEV_BYPASS)
        importlib.reload(settings_module)

    def test_a_public_host_without_bypass_is_unaffected(self):
        import importlib
        import os

        from core import settings as settings_module

        with patch.dict(os.environ, {"DJANGO_ALLOWED_HOSTS": "app.example.com", "AUTH_DEV_BYPASS": "False"}):
            reloaded = importlib.reload(settings_module)
            self.assertIn("app.example.com", reloaded.ALLOWED_HOSTS)
        importlib.reload(settings_module)


class ParseJsonBodyTests(SimpleTestCase):
    """MSC-4：非 dict 的 JSON 本文讓後台 view 回 500；一律當格式錯誤。"""

    def _parse(self, body):
        from adminapi._shared import parse_json_body

        return parse_json_body(RequestFactory().post("/x", data=body, content_type="application/json"))

    def test_objects_and_empty_bodies_are_accepted(self):
        self.assertEqual(self._parse(json.dumps({"a": 1}))[0], {"a": 1})
        self.assertEqual(self._parse("")[0], {})
        self.assertEqual(self._parse("{}")[0], {})

    def test_non_object_json_is_a_400_not_a_crash(self):
        for body in ("[]", "[1,2]", "null", "5", "true", '"text"', "{bad", b"\xff\xfe"):
            with self.subTest(body=body):
                data, error = self._parse(body)
                self.assertIsNone(data)
                self.assertEqual(error.status_code, 400)

    def test_a_real_view_answers_400_instead_of_500_for_a_list_body(self):
        from adminapi.auth_fixtures import fresh_auth

        with override_settings(AUTH_DEV_BYPASS=False), patch("core.firebase_auth.ensure_firebase_initialized"), \
                patch("firebase_admin.auth.verify_id_token", return_value=fresh_auth({"uid": "u", "role": "owner"})):
            response = self.client_class().post(
                "/adminapi/ai-assistant/settings/trial/", data="[1]", content_type="application/json",
                HTTP_AUTHORIZATION="Bearer t",
            )
        self.assertEqual(response.status_code, 400)


class CrosswordSerializerLimitsTests(SimpleTestCase):
    def _payload(self, legend):
        return {"user_answers": [["a"]], "crossword_solution": ["a"], "crossword_legend": legend}

    @staticmethod
    def _item(**overrides):
        item = {"number": 1, "word": "ab", "clue": "c", "direction": "across", "start_col": 1, "start_row": 1, "length": 2}
        item.update(overrides)
        return item

    def test_normal_payload_is_valid(self):
        from CrosswordPuzzle.serializers import SubmitAnsSerializer

        self.assertTrue(SubmitAnsSerializer(data=self._payload([self._item()])).is_valid())
        self.assertTrue(SubmitAnsSerializer(data=self._payload([self._item()] * 50)).is_valid())

    def test_legend_over_fifty_items_is_refused(self):
        from CrosswordPuzzle.serializers import SubmitAnsSerializer

        serializer = SubmitAnsSerializer(data=self._payload([self._item()] * 51))
        self.assertFalse(serializer.is_valid())
        self.assertIn("crossword_legend", serializer.errors)

    def test_length_has_an_upper_bound(self):
        from CrosswordPuzzle.serializers import SubmitAnsSerializer

        self.assertTrue(SubmitAnsSerializer(data=self._payload([self._item(length=50)])).is_valid())
        serializer = SubmitAnsSerializer(data=self._payload([self._item(length=10**9)]))
        self.assertFalse(serializer.is_valid())
