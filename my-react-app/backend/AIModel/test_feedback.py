"""AI 助手使用者回饋（路線圖 #30）：學生端點、後台檢視、題組轉換、清理指令。"""
import datetime
import json
from contextlib import contextmanager
from io import StringIO
from unittest.mock import patch

from django.core.cache import cache
from django.core.management import call_command
from django.test import Client, TestCase
from django.test.utils import override_settings
from django.utils import timezone

from adminapi.auth_fixtures import fresh_auth
from adminapi.models import AiFeedback, AiUsageLog, AuditLog, FeatureFlag
from AIModel.evals.cases import validate_case
from AIModel.evals.feedback_cases import build_feedback_case, load_feedback_cases
from AIModel.feedback import FLAG_KEY, hash_uid
from AIModel.services import sign_reply
from AIModel.tests import _mock_chat_client

UID = "dev-user"                       # AUTH_DEV_BYPASS 下的使用者
REPLY = "lokah 是「你好、謝謝」的意思。"


def _enable(enabled=True):
    FeatureFlag.objects.update_or_create(key=FLAG_KEY, defaults={"label": "x", "description": "", "enabled": enabled})


def _payload(**overrides):
    body = {
        "rating": "down", "reason": "wrong_tribal", "comment": "拼法不對",
        "question_text": "lokah 是什麼意思？", "reply_text": REPLY, "sig": sign_reply(UID, REPLY),
        "tribe": "tayal", "request_id": "req_abc123", "model": "claude-sonnet-5-5", "prompt_version": "0a1b2c3d",
    }
    body.update(overrides)
    return body


class FeedbackEndpointTest(TestCase):
    def setUp(self):
        self.http = Client()
        cache.clear()

    def _post(self, body):
        return self.http.post("/AIModel/feedback/", data=json.dumps(body), content_type="application/json")

    def test_flag_missing_or_off_is_a_403_and_stores_nothing(self):
        for setup in (lambda: None, lambda: _enable(False)):
            setup()
            response = self._post(_payload())
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json()["code"], "ai_feedback_disabled")
        self.assertEqual(AiFeedback.objects.count(), 0)

    def test_assistant_master_switch_off_blocks_feedback(self):
        _enable()
        FeatureFlag.objects.update_or_create(
            key="ai_assistant_enabled", defaults={"label": "AI 助手", "description": "", "enabled": False})
        self.assertEqual(self._post(_payload()).status_code, 403)

    def test_only_post_is_accepted(self):
        _enable()
        self.assertEqual(self.http.get("/AIModel/feedback/").status_code, 405)

    def test_stores_the_feedback_with_a_hashed_uid_and_the_traceability_fields(self):
        _enable()
        AiUsageLog.objects.create(feature="chat", model="claude-sonnet-5-5", status="ok", uid=UID, request_id="req_abc123")
        response = self._post(_payload())
        self.assertEqual(response.status_code, 200)
        row = AiFeedback.objects.get()
        self.assertEqual((row.rating, row.reason, row.comment), ("down", "wrong_tribal", "拼法不對"))
        self.assertEqual((row.model, row.prompt_version, row.request_id), ("claude-sonnet-5-5", "0a1b2c3d", "req_abc123"))
        self.assertEqual(row.uid_hash, hash_uid(UID))
        self.assertNotIn(UID, row.uid_hash)
        self.assertEqual(len(row.uid_hash), 32)

    def test_request_id_and_model_are_only_kept_when_the_usage_log_confirms_them(self):
        _enable()
        AiUsageLog.objects.create(feature="chat", model="real-model", status="ok", uid="someone-else", request_id="req_abc123")
        self._post(_payload(model="claude-fake"))
        row = AiFeedback.objects.get()
        self.assertEqual((row.request_id, row.model), ("", ""))          # 別人的 request id：不採信
        AiFeedback.objects.all().delete()
        AiUsageLog.objects.create(feature="chat", model="real-model", status="ok", uid=UID, request_id="req_abc123")
        self._post(_payload(model="claude-fake"))
        row = AiFeedback.objects.get()
        self.assertEqual((row.request_id, row.model), ("req_abc123", "real-model"))   # 模型以紀錄為準

    def test_expired_feedback_is_purged_without_any_scheduler(self):
        _enable()
        old = AiFeedback.objects.create(uid_hash="o", reply_sig="9" * 64, rating="up", question_text="q", reply_text="r", tribe="tayal")
        AiFeedback.objects.filter(pk=old.pk).update(created_at=timezone.now() - datetime.timedelta(days=400))
        self._post(_payload())
        self.assertFalse(AiFeedback.objects.filter(pk=old.pk).exists())

    def test_the_raw_uid_is_stored_nowhere_in_the_row(self):
        _enable()
        self._post(_payload())
        values = " ".join(str(v) for v in AiFeedback.objects.values().get().values())
        self.assertNotIn(UID, values)

    def test_a_reply_the_assistant_never_said_is_rejected(self):
        _enable()
        for body in (
            _payload(reply_text="我是被偽造的回覆"),                      # 簽章對不上內容
            _payload(sig=sign_reply("someone-else", REPLY)),              # 別人的簽章
            _payload(sig="0" * 64),
            _payload(sig="not-a-signature"),
        ):
            self.assertEqual(self._post(body).status_code, 400)
        self.assertEqual(AiFeedback.objects.count(), 0)

    def test_thumbs_up_drops_reason_and_comment(self):
        _enable()
        self._post(_payload(rating="up", reason="too_long", comment="其實不錯"))
        row = AiFeedback.objects.get()
        self.assertEqual((row.rating, row.reason, row.comment), ("up", "", ""))

    def test_validation_limits(self):
        _enable()
        for name, body in {
            "未知評價": _payload(rating="meh"),
            "未知原因": _payload(reason="boring"),
            "說明太長": _payload(comment="字" * 301),
            "問題太長": _payload(question_text="字" * 1001),
            "沒有問題": _payload(question_text=" "),
            "未知族語": _payload(tribe="klingon"),
            "request id 含怪字元": _payload(request_id="a b<script>"),
            "版本含怪字元": _payload(prompt_version="zzzz"),
        }.items():
            with self.subTest(name):
                self.assertEqual(self._post(body).status_code, 400)

    def test_changing_your_mind_updates_instead_of_adding(self):
        _enable()
        self._post(_payload(rating="down"))
        self._post(_payload(rating="up"))
        self.assertEqual(AiFeedback.objects.count(), 1)
        self.assertEqual(AiFeedback.objects.get().rating, "up")

    def test_malformed_body_is_a_400(self):
        _enable()
        response = self.http.post("/AIModel/feedback/", data="{oops", content_type="application/json")
        self.assertEqual(response.status_code, 400)

    def test_quota_reports_feedback_availability(self):
        self.assertFalse(self.http.get("/AIModel/quota/").json()["features"]["feedback"])
        _enable()
        self.assertTrue(self.http.get("/AIModel/quota/").json()["features"]["feedback"])

    @patch("AIModel.views._get_client")
    def test_chat_reply_carries_meta_for_traceability(self, mock_get_client):
        mock_get_client.return_value = _mock_chat_client("哈囉")
        body = self.http.post("/AIModel/tayal_chat/", data=json.dumps({"message": "hi"}), content_type="application/json").json()
        self.assertEqual(set(body["meta"]), {"model", "requestId", "promptVersion"})
        self.assertRegex(body["meta"]["promptVersion"], r"^[0-9a-f]{8}$")


class AdminFeedbackViewTest(TestCase):
    def setUp(self):
        self.http = Client()
        self.up = AiFeedback.objects.create(
            uid_hash=hash_uid("a"), reply_sig="1" * 64, rating="up", question_text="Q1", reply_text="R1", tribe="tayal")
        self.down = AiFeedback.objects.create(
            uid_hash=hash_uid("b"), reply_sig="2" * 64, rating="down", reason="too_long", comment="太長了",
            question_text="Q2", reply_text="R2", tribe="tayal", model="m", prompt_version="deadbeef", request_id="req_1")

    @contextmanager
    def _as(self, role):
        with override_settings(AUTH_DEV_BYPASS=False):
            with patch("core.firebase_auth.ensure_firebase_initialized"):
                decoded = {"uid": "admin-1"}
                if role:
                    decoded["role"] = role
                with patch("firebase_admin.auth.verify_id_token", return_value=fresh_auth(decoded)):
                    yield {"HTTP_AUTHORIZATION": "Bearer t"}

    def test_only_owner_and_admin_may_read_the_content(self):
        for role, expected in (("owner", 200), ("admin", 200), ("editor", 403), ("analyst", 403), (None, 403)):
            with self.subTest(role=role), self._as(role) as headers:
                self.assertEqual(self.http.get("/adminapi/ai-feedback/", **headers).status_code, expected)

    def test_anonymous_is_rejected(self):
        with override_settings(AUTH_DEV_BYPASS=False):
            self.assertEqual(self.http.get("/adminapi/ai-feedback/").status_code, 401)

    def test_list_shows_traceability_and_never_the_full_hash(self):
        with self._as("owner") as headers:
            body = self.http.get("/adminapi/ai-feedback/", **headers).json()
        item = next(i for i in body["items"] if i["id"] == self.down.pk)
        self.assertEqual((item["model"], item["promptVersion"], item["requestId"]), ("m", "deadbeef", "req_1"))
        self.assertEqual(item["user"], hash_uid("b")[:8])
        self.assertNotIn(hash_uid("b"), json.dumps(body))
        self.assertEqual(body["summary"]["up"], 1)
        self.assertEqual(body["summary"]["byReason"]["too_long"], 1)

    def test_filters_and_validation(self):
        with self._as("admin") as headers:
            get = lambda q: self.http.get(f"/adminapi/ai-feedback/?{q}", **headers)
            self.assertEqual([i["id"] for i in get("rating=down").json()["items"]], [self.down.pk])
            self.assertEqual([i["id"] for i in get("reason=too_long").json()["items"]], [self.down.pk])
            self.assertEqual(get("candidate=1").json()["count"], 0)
            self.assertEqual(get("rating=bad").status_code, 400)
            self.assertEqual(get("reason=bad").status_code, 400)
            self.assertEqual(get("page=x").status_code, 400)
            self.assertEqual(get("page=99").json()["page"], 1)

    def test_marking_a_candidate_is_audited_and_reversible(self):
        url = f"/adminapi/ai-feedback/{self.down.pk}/eval-candidate/"
        with self._as("admin") as headers:
            post = lambda body: self.http.post(url, data=json.dumps(body), content_type="application/json", **headers)
            self.assertEqual(post({"candidate": True, "note": "x"}).status_code, 400)       # 沒填審過的問題
            self.assertEqual(post({"candidate": True, "note": "答案應該簡短", "question": "lokah 是什麼意思？"}).status_code, 200)
            self.down.refresh_from_db()
            self.assertTrue(self.down.eval_candidate)
            self.assertEqual(self.down.eval_question, "lokah 是什麼意思？")
            self.assertEqual(self.down.eval_marked_by, "admin-1")
            self.assertEqual(AuditLog.objects.filter(action="ai_feedback_eval_mark").count(), 1)
            self.assertEqual(post({"candidate": False}).status_code, 200)
            self.down.refresh_from_db()
            self.assertEqual((self.down.eval_candidate, self.down.eval_note, self.down.eval_marked_by, self.down.eval_question), (False, "", "", ""))
            for bad in ({"candidate": "yes"}, {"candidate": True, "note": "x" * 301, "question": "q"}, {"candidate": True, "question": "q" * 301}, {"note": "x"}):
                self.assertEqual(post(bad).status_code, 400)

    def test_editor_cannot_mark_and_unknown_id_is_404(self):
        with self._as("editor") as headers:
            response = self.http.post(f"/adminapi/ai-feedback/{self.down.pk}/eval-candidate/",
                                      data=json.dumps({"candidate": True, "question": "q"}), content_type="application/json", **headers)
            self.assertEqual(response.status_code, 403)
        with self._as("owner") as headers:
            response = self.http.post("/adminapi/ai-feedback/99999/eval-candidate/",
                                      data=json.dumps({"candidate": True, "question": "q"}), content_type="application/json", **headers)
            self.assertEqual(response.status_code, 404)


class FeedbackEvalCasesTest(TestCase):
    def _row(self, reason, note="", candidate=True):
        return AiFeedback.objects.create(
            uid_hash=hash_uid(reason), reply_sig=(reason + "-" * 64)[:64], rating="down", reason=reason, eval_candidate=candidate,
            eval_note=note, eval_question=f"審過的問題-{reason}", question_text=f"含個資的原文-{reason}", reply_text="r", tribe="tayal")

    def test_only_marked_candidates_become_cases_and_all_validate(self):
        for reason in ("wrong_tribal", "irrelevant", "too_hard", "too_long", "other"):
            self._row(reason)
        AiFeedback.objects.create(uid_hash="x", reply_sig="9" * 64, rating="down", question_text="未標記", reply_text="r", tribe="tayal")
        cases = load_feedback_cases()
        self.assertEqual(len(cases), 5)
        for case in cases:
            validate_case(case)
            self.assertEqual(case["category"], "feedback")

    def test_the_replayed_question_is_the_reviewed_one_never_the_student_original(self):
        case = build_feedback_case(self._row("other"))
        self.assertEqual(case["message"], "審過的問題-other")
        self.assertNotIn("含個資", json.dumps(case, ensure_ascii=False))

    def test_candidates_without_a_reviewed_question_are_skipped(self):
        row = self._row("other")
        AiFeedback.objects.filter(pk=row.pk).update(eval_question="")
        self.assertEqual(load_feedback_cases(), [])

    def test_reason_shapes_the_checks_and_the_note_reaches_the_judge(self):
        too_long = build_feedback_case(self._row("too_long", note="一句話就好"))
        self.assertEqual(too_long["checks"], [{"type": "max_chars", "value": 300}])
        self.assertIn("一句話就好", too_long["judge"])
        self.assertEqual(build_feedback_case(self._row("wrong_tribal"))["checks"], [{"type": "no_unverified"}])


class PurgeFeedbackTest(TestCase):
    def test_preview_then_delete_only_expired(self):
        old = AiFeedback.objects.create(uid_hash="a", reply_sig="1" * 64, rating="up", question_text="q", reply_text="r", tribe="tayal")
        AiFeedback.objects.filter(pk=old.pk).update(created_at=timezone.now() - datetime.timedelta(days=200))
        AiFeedback.objects.create(uid_hash="b", reply_sig="2" * 64, rating="up", question_text="q", reply_text="r", tribe="tayal")

        out = StringIO()
        call_command("purge_ai_feedback", stdout=out)
        self.assertEqual(AiFeedback.objects.count(), 2)
        self.assertIn("預覽", out.getvalue())

        call_command("purge_ai_feedback", "--yes", stdout=StringIO())
        self.assertEqual(AiFeedback.objects.count(), 1)
