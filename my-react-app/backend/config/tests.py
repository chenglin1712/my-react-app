"""測試 config/auth_flags.py 與 core/firebase_auth.py：這波稽核指出 DEBUG／
AUTH_DEV_BYPASS 互鎖邏輯是全站認證最關鍵的一段判斷，卻沒有專屬測試檔案，只靠
其他 app 的測試間接覆蓋到（等於「有沒有真的鎖住」從來沒被直接驗證過）。
"""
import json
import time
from unittest.mock import patch

from django.http import JsonResponse
from django.test import TestCase, override_settings

from config.auth_flags import auth_dev_bypass
from core.firebase_auth import require_role, verify_firebase_token
from config.roles import ADMIN, EDITOR, OWNER, STAFF_ROLES
from config.tribes import (
    TRIBE_DATA,
    TRIBE_IDS,
    TRIBE_LANG_CODES,
    TRIBE_MAP,
    TRIBES,
    build_tribe_tables,
    resolve_tribe_name,
)


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


class TribeSingleSourceTest(TestCase):
    """族群資料單一來源（N-6）：tribes.json 是唯一來源，tribes.py 只是把它轉成既有介面。"""

    def test_current_five_tribes_are_unchanged(self):
        self.assertEqual([t.slug for t in TRIBES], ["tayal", "amis", "bunun", "kavalan", "paiwan"])
        self.assertEqual(TRIBE_MAP["tayal"], "泰雅語")
        self.assertEqual(set(TRIBE_IDS), {"tayal", "amis", "bunun", "kavalan", "paiwan"})

    def test_kavalan_uses_official_spelling_but_keeps_db_name(self):
        kavalan = next(t for t in TRIBES if t.slug == "kavalan")
        self.assertEqual(kavalan.short_name, "噶瑪蘭")
        # 資料庫 tribe.name 仍是舊譯名，查詢要用它
        self.assertEqual(kavalan.full_name, "葛瑪蘭語")
        for spelling in ("噶瑪蘭", "噶瑪蘭語", "葛瑪蘭", "葛瑪蘭語", "kavalan"):
            self.assertEqual(resolve_tribe_name(spelling), "葛瑪蘭語")

    def test_adding_one_entry_makes_it_appear_everywhere(self):
        extra = {
            "slug": "demo", "name": "測試", "fullName": "測試語", "roman": "Demo", "color": "#123456",
            "langCode": None, "id": "00000000-0000-0000-0000-000000000001", "enabled": True,
        }
        tribes, tribe_map, tribe_ids = build_tribe_tables(TRIBE_DATA + [extra])
        self.assertIn("demo", [t.slug for t in tribes])
        self.assertEqual(tribe_map["測試"], "測試語")
        self.assertEqual(tribe_ids["demo"], extra["id"])

    def test_reserved_entries_are_not_enabled(self):
        # 官方承認 16 族，目前啟用 5 族；其餘預留，前後端都不使用
        self.assertEqual(len(TRIBE_DATA), 16)
        self.assertEqual(len(TRIBES), 5)
        reserved = [t for t in TRIBE_DATA if not t.get("enabled")]
        self.assertEqual(len(reserved), 11)
        for entry in reserved:
            self.assertNotIn(entry["slug"], TRIBE_IDS)

    def test_enabled_entry_without_id_is_rejected(self):
        broken = {"slug": "x", "name": "某", "fullName": "某語", "enabled": True}
        with self.assertRaises(ValueError):
            build_tribe_tables([broken])

    def test_display_name_is_official_while_db_name_stays_legacy(self):
        kavalan = next(t for t in TRIBES if t.slug == "kavalan")
        self.assertEqual(kavalan.display_name, "噶瑪蘭語")
        self.assertEqual(kavalan.full_name, "葛瑪蘭語")
        self.assertEqual(next(t for t in TRIBES if t.slug == "tayal").display_name, "泰雅語")

    def test_duplicate_slug_id_or_name_is_rejected(self):
        base = {"name": "甲", "fullName": "甲語", "enabled": True}
        with self.assertRaises(ValueError):
            build_tribe_tables([{**base, "slug": "a", "id": "1"}, {**base, "slug": "a", "id": "2", "name": "乙", "fullName": "乙語"}])
        with self.assertRaises(ValueError):
            build_tribe_tables([{**base, "slug": "a", "id": "1"}, {**base, "slug": "b", "id": "1", "name": "乙", "fullName": "乙語"}])
        with self.assertRaises(ValueError):
            # 兩個族群共用同一個簡稱
            build_tribe_tables([{**base, "slug": "a", "id": "1"}, {**base, "slug": "b", "id": "2", "fullName": "丙語"}])

    def test_slugs_are_unique(self):
        slugs = [t["slug"] for t in TRIBE_DATA]
        self.assertEqual(len(slugs), len(set(slugs)))

    def test_lang_codes_cover_the_five_enabled_tribes(self):
        self.assertEqual(
            TRIBE_LANG_CODES,
            {"tayal": "tay", "amis": "ami", "bunun": "bnn", "kavalan": "ckv", "paiwan": "pwn"},
        )


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
    """core/firebase_auth.py 的 verify_firebase_token：Django 端消費
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
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            with patch("firebase_admin.auth.verify_id_token", return_value={"uid": "real-user"}):
                decoded, error = verify_firebase_token(_FakeRequest(auth_header="Bearer sometoken"))
        self.assertEqual(decoded, {"uid": "real-user"})
        self.assertIsNone(error)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_verifies_with_check_revoked_true(self):
        # 獨立審查找到的問題：預設的 verify_id_token() 不查撤銷/停權狀態，
        # 強制登出、停權、收回角色之後，舊 token 在到期前仍會通過驗證。
        # 這裡鎖定「一定有帶 check_revoked=True」，不只是「回傳值對不對」，
        # 避免這個旗標之後被意外改掉或漏帶而沒有任何測試發現。
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            with patch("firebase_admin.auth.verify_id_token", return_value={"uid": "real-user"}) as mock_verify:
                verify_firebase_token(_FakeRequest(auth_header="Bearer sometoken"))
        mock_verify.assert_called_once_with("sometoken", check_revoked=True)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_disabled_user_token_returns_401_without_logging(self):
        # UserDisabledError 不是 InvalidIdTokenError 的子類別（各自獨立繼承自
        # InvalidArgumentError）——這是這次修正特別要接住的分支，帳號被停權後
        # 的正常拒絕不該被誤記成非預期例外灌爆 Sentry。
        import firebase_admin.auth as fa

        with patch("core.firebase_auth.ensure_firebase_initialized"):
            with patch(
                "firebase_admin.auth.verify_id_token",
                side_effect=fa.UserDisabledError("user disabled"),
            ):
                with patch("core.firebase_auth.logger") as mock_logger:
                    decoded, error = verify_firebase_token(_FakeRequest(auth_header="Bearer sometoken"))
        self.assertIsNone(decoded)
        self.assertEqual(error.status_code, 401)
        mock_logger.exception.assert_not_called()

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_revoked_token_returns_401_without_logging(self):
        import firebase_admin.auth as fa

        with patch("core.firebase_auth.ensure_firebase_initialized"):
            with patch(
                "firebase_admin.auth.verify_id_token",
                side_effect=fa.RevokedIdTokenError("token revoked"),
            ):
                with patch("core.firebase_auth.logger") as mock_logger:
                    decoded, error = verify_firebase_token(_FakeRequest(auth_header="Bearer sometoken"))
        self.assertIsNone(decoded)
        self.assertEqual(error.status_code, 401)
        mock_logger.exception.assert_not_called()

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_invalid_token_returns_401_without_logging(self):
        # 單一使用者 token 過期／被撤銷是正常流量，不應該被記成 error log。
        import firebase_admin.auth as fa

        with patch("core.firebase_auth.ensure_firebase_initialized"):
            with patch("firebase_admin.auth.verify_id_token", side_effect=fa.ExpiredIdTokenError("expired", cause=None)):
                with patch("core.firebase_auth.logger") as mock_logger:
                    decoded, error = verify_firebase_token(_FakeRequest(auth_header="Bearer badtoken"))
        self.assertIsNone(decoded)
        self.assertEqual(error.status_code, 401)
        mock_logger.exception.assert_not_called()

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_unexpected_exception_returns_401_and_logs(self):
        # 這是本輪修正的重點：非 InvalidIdTokenError 的例外（憑證抓取失敗等）
        # 代表驗證機制本身可能整個掛掉，必須被記錄下來才能讓 Sentry 告警。
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            with patch("firebase_admin.auth.verify_id_token", side_effect=RuntimeError("boom")):
                with patch("core.firebase_auth.logger") as mock_logger:
                    decoded, error = verify_firebase_token(_FakeRequest(auth_header="Bearer sometoken"))
        self.assertIsNone(decoded)
        self.assertEqual(error.status_code, 401)
        mock_logger.exception.assert_called_once()

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_missing_service_account_returns_503_and_logs(self):
        with patch(
            "core.firebase_auth.ensure_firebase_initialized",
            side_effect=EnvironmentError("FIREBASE_SERVICE_ACCOUNT_PATH 未設定"),
        ):
            with patch("core.firebase_auth.logger") as mock_logger:
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
            "core.firebase_auth.ensure_firebase_initialized",
            side_effect=ValueError("Invalid certificate"),
        ):
            with patch("core.firebase_auth.logger") as mock_logger:
                decoded, error = verify_firebase_token(_FakeRequest(auth_header="Bearer sometoken"))
        self.assertIsNone(decoded)
        self.assertEqual(error.status_code, 503)
        mock_logger.exception.assert_called_once()


class RequireRoleTest(TestCase):
    """core/firebase_auth.py 的 require_role：後台管理系統每一支 API 都要靠
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
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            claims = {"uid": "u1", "role": ADMIN, "auth_time": int(time.time())}
            with patch("firebase_admin.auth.verify_id_token", return_value=claims):
                decoded, error = require_role(_FakeRequest(auth_header="Bearer t"), (OWNER, ADMIN))
        self.assertEqual(decoded, claims)
        self.assertIsNone(error)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_role_not_in_allowed_list_returns_403(self):
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            with patch("firebase_admin.auth.verify_id_token", return_value={"uid": "u1", "role": EDITOR}):
                decoded, error = require_role(_FakeRequest(auth_header="Bearer t"), (OWNER, ADMIN))
        self.assertIsNone(decoded)
        self.assertEqual(error.status_code, 403)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_learner_without_role_claim_returns_403(self):
        # 一般學習者帳號沒有 role claim，decoded.get("role") 會是 None，
        # 必須被擋在任何非空的 allowed_roles 清單外，不能因為「沒有這個 key」
        # 就意外通過 in 判斷。
        with patch("core.firebase_auth.ensure_firebase_initialized"):
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


class RequireRoleFreshnessTest(TestCase):
    """require_role 的「最近用密碼驗證過」檢查（auth_time 新鮮度）。

    前端進後台會要求重新輸入密碼，但前端旗標任何人都能自己設，所以真正的把關在後端：
    ID token 的 auth_time 太舊（或缺漏、型別不對、來自未來太遠）就回 401 reauth_required。
    """

    def _call(self, claims, roles=(OWNER, ADMIN)):
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            with patch("firebase_admin.auth.verify_id_token", return_value=claims):
                return require_role(_FakeRequest(auth_header="Bearer t"), roles)

    def _assert_reauth_required(self, error):
        self.assertEqual(error.status_code, 401)
        self.assertEqual(json.loads(error.content)["code"], "reauth_required")

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_recent_authentication_passes(self):
        decoded, error = self._call({"uid": "u1", "role": ADMIN, "auth_time": int(time.time()) - 60})
        self.assertIsNone(error)
        self.assertEqual(decoded["uid"], "u1")

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_authentication_older_than_the_window_requires_reauth(self):
        decoded, error = self._call({"uid": "u1", "role": ADMIN, "auth_time": int(time.time()) - 1801 - 5})
        self.assertIsNone(decoded)
        self._assert_reauth_required(error)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_exactly_inside_the_window_still_passes(self):
        _, error = self._call({"uid": "u1", "role": ADMIN, "auth_time": int(time.time()) - 1790})
        self.assertIsNone(error)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_missing_auth_time_requires_reauth(self):
        _, error = self._call({"uid": "u1", "role": ADMIN})
        self._assert_reauth_required(error)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_malformed_auth_time_requires_reauth(self):
        for bad in ("1700000000", None, True, [1], {"a": 1}):
            with self.subTest(bad=bad):
                _, error = self._call({"uid": "u1", "role": ADMIN, "auth_time": bad})
                self._assert_reauth_required(error)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_small_clock_skew_into_the_future_is_tolerated(self):
        _, error = self._call({"uid": "u1", "role": ADMIN, "auth_time": int(time.time()) + 30})
        self.assertIsNone(error)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_auth_time_far_in_the_future_is_rejected(self):
        # 偽造或時鐘嚴重錯誤的 token，不能因為「age 是負數」就永遠新鮮
        _, error = self._call({"uid": "u1", "role": ADMIN, "auth_time": int(time.time()) + 3600})
        self._assert_reauth_required(error)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_role_check_comes_first_so_non_staff_cannot_learn_about_reauth(self):
        # 沒有後台角色的人，不論 auth_time 新舊都是 403，不會看到 reauth_required
        decoded, error = self._call({"uid": "learner", "auth_time": 1}, roles=STAFF_ROLES)
        self.assertIsNone(decoded)
        self.assertEqual(error.status_code, 403)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_the_window_can_be_configured_but_never_disabled(self):
        old = {"uid": "u1", "role": ADMIN, "auth_time": int(time.time()) - 600}
        with patch.dict("os.environ", {"ADMIN_REAUTH_MAX_AGE_SECONDS": "300"}):
            self._assert_reauth_required(self._call(old)[1])
        for bad in ("0", "-5", "abc", ""):
            with self.subTest(setting=bad), patch.dict("os.environ", {"ADMIN_REAUTH_MAX_AGE_SECONDS": bad}):
                # 設成 0／負數／亂碼時退回預設 30 分鐘，不會變成「不檢查」
                self.assertIsNone(self._call(old)[1])

    @override_settings(AUTH_DEV_BYPASS=True)
    def test_dev_bypass_has_no_token_so_the_check_is_skipped(self):
        decoded, error = self._call({"uid": "ignored"})
        self.assertIsNone(error)
        self.assertEqual(decoded["uid"], "dev-user")


class ApplyTribeReviewTest(TestCase):
    """F-3 審閱單判定接進 tribes.json：只有七項全部有效才 confirmed，意見不會自動改值。"""

    def _write(self, folder, slug, element, **fields):
        import pathlib
        d = pathlib.Path(folder) / "reviews"
        d.mkdir(exist_ok=True)
        doc = {"tribe": slug, "element": element, "verdict": "ok", "who": "老師", "date": "2026-10-20", "source": "部落會議", "note": ""}
        doc.update(fields)
        (d / f"{slug}__{element}.json").write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")

    def _setup(self, tmp):
        import pathlib
        import shutil
        from config import apply_tribe_review as mod
        src = pathlib.Path(mod.TRIBES_PATH)
        tp = pathlib.Path(tmp) / "tribes.json"
        shutil.copyfile(src, tp)
        return mod, tp, pathlib.Path(tmp) / "tribe_reviews.json"

    def test_all_seven_ok_confirms_only_that_tribe(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            mod, tp, rp = self._setup(tmp)
            before = tp.read_bytes()
            for e in mod.ELEMENTS:
                self._write(tmp, "paiwan", e)
            statuses, _ = mod.apply(tmp, write=True, tribes_path=tp, reviews_path=rp)
            self.assertEqual(statuses["paiwan"], "confirmed")
            self.assertEqual(statuses["tayal"], "unconfirmed")
            after = json.loads(tp.read_text(encoding="utf-8"))
            by = {t["slug"]: t for t in after["tribes"]}
            self.assertEqual(by["paiwan"]["reviewStatus"], "confirmed")
            self.assertEqual(by["tayal"]["reviewStatus"], "unconfirmed")
            # 除了那一個值，檔案其他位元組都沒動
            self.assertEqual(len(tp.read_bytes()) - len(before), len("confirmed") - len("unconfirmed"))
            self.assertEqual(tp.read_bytes().replace(b'"confirmed"', b'"unconfirmed"', 1), before)
            self.assertIn("paiwan", json.loads(rp.read_text(encoding="utf-8")))

    def test_missing_signoff_does_not_count(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            mod, tp, rp = self._setup(tmp)
            for e in mod.ELEMENTS:
                self._write(tmp, "amis", e, source="" if e == "copy" else "部落會議")
            statuses, report = mod.apply(tmp, write=True, tribes_path=tp, reviews_path=rp)
            self.assertEqual(statuses["amis"], "unconfirmed")
            self.assertTrue(any("沒填對" in line for line in report))

    def test_warn_only_reports_and_never_changes_values(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            mod, tp, rp = self._setup(tmp)
            before = json.loads(tp.read_text(encoding="utf-8"))
            self._write(tmp, "bunun", "color", verdict="warn", note="顏色太接近別族")
            statuses, report = mod.apply(tmp, write=True, tribes_path=tp, reviews_path=rp)
            self.assertEqual(statuses["bunun"], "unconfirmed")
            self.assertTrue(any("顏色太接近別族" in line for line in report))
            self.assertEqual(json.loads(tp.read_text(encoding="utf-8")), before)

    def test_confirmed_drops_back_when_an_item_is_no_longer_ok(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            mod, tp, rp = self._setup(tmp)
            for e in mod.ELEMENTS:
                self._write(tmp, "paiwan", e)
            mod.apply(tmp, write=True, tribes_path=tp, reviews_path=rp)
            self._write(tmp, "paiwan", "roman", verdict="bad", note="拼寫錯")
            statuses, _ = mod.apply(tmp, write=True, tribes_path=tp, reviews_path=rp)
            self.assertEqual(statuses["paiwan"], "unconfirmed")
            by = {t["slug"]: t for t in json.loads(tp.read_text(encoding="utf-8"))["tribes"]}
            self.assertEqual(by["paiwan"]["reviewStatus"], "unconfirmed")

    def test_dry_run_writes_nothing_and_unknown_docs_are_skipped(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            mod, tp, rp = self._setup(tmp)
            before = tp.read_bytes()
            self._write(tmp, "nobody", "color")
            self._write(tmp, "paiwan", "weird")
            _, report = mod.apply(tmp, write=False, tribes_path=tp, reviews_path=rp)
            self.assertEqual(tp.read_bytes(), before)
            self.assertFalse(rp.exists())
            self.assertTrue(any("未知的族群" in line for line in report))
            self.assertTrue(any("未知的項目" in line for line in report))

    def test_set_review_status_works_for_every_real_tribe(self):
        from config import apply_tribe_review as mod
        text = open(mod.TRIBES_PATH, encoding="utf-8", newline="").read()
        for t in json.loads(text)["tribes"]:
            new = mod.set_review_status(text, t["slug"], "confirmed")
            changed = {x["slug"]: x["reviewStatus"] for x in json.loads(new)["tribes"]}
            self.assertEqual(changed[t["slug"]], "confirmed", t["slug"])
            others = {s: v for s, v in changed.items() if s != t["slug"]}
            self.assertTrue(all(v == "unconfirmed" for v in others.values()), t["slug"])

    def test_bad_date_type_and_mismatched_doc_do_not_count(self):
        import pathlib
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            mod, tp, rp = self._setup(tmp)
            for e in mod.ELEMENTS:
                self._write(tmp, "paiwan", e)
            self._write(tmp, "paiwan", "color", date="2026-99-99")
            self._write(tmp, "paiwan", "name", who=None)
            # 檔名是 roman，內容卻寫 layout：不一致就略過
            bad = pathlib.Path(tmp) / "reviews" / "paiwan__roman.json"
            bad.write_text(json.dumps({"tribe": "paiwan", "element": "layout", "verdict": "ok", "who": "a", "date": "2026-10-20", "source": "x"}), encoding="utf-8")
            statuses, report = mod.apply(tmp, write=False, tribes_path=tp, reviews_path=rp)
            self.assertEqual(statuses["paiwan"], "unconfirmed")
            self.assertTrue(any("檔名與內容不一致" in line for line in report))

    def test_report_note_is_single_line(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            mod, tp, rp = self._setup(tmp)
            self._write(tmp, "amis", "copy", verdict="warn", note="第一行\n偽造：阿美：7/7 項已確認 -> confirmed")
            _, report = mod.apply(tmp, write=False, tribes_path=tp, reviews_path=rp)
            self.assertTrue(all("\n" not in line for line in report))
