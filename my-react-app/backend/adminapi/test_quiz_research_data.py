"""詞素學習研究資料的 Django 端：資料表約束、清除服務與指令、刪除帳號時一併清除。"""
import io
import os
from datetime import timedelta
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from adminapi import quiz_research_service as svc
from adminapi.models import QuizResearchConsent, QuizSkillEvent
from config import quiz_research as QR

SALT = "unit-test-salt-0123456789-abcdefghijklmnopqrstuvwxyz"


def _event(pseudonym, nonce, **kw):
    fields = dict(pseudonym=pseudonym, nonce=nonce, occurred_at=timezone.now(), tribe="amis", question_type="sentence-fill",
                  target_rule_id="v1|amis|P|ma||0", diagnosis_status="correct", correct=True, probe=True, seconds_bucket=1,
                  model_version="bkt-blend-1", selection_policy="baseline", consent_version=QR.CONSENT_VERSION)
    fields.update(kw)
    return QuizSkillEvent.objects.create(**fields)


class ModelConstraintTests(TestCase):
    def test_the_same_nonce_cannot_be_recorded_twice_for_one_pseudonym(self):
        _event("p1", "n1")
        with self.assertRaises(IntegrityError), transaction.atomic():
            _event("p1", "n1")

    def test_the_same_nonce_for_different_pseudonyms_is_fine(self):
        _event("p1", "n1")
        _event("p2", "n1")
        self.assertEqual(QuizSkillEvent.objects.count(), 2)

    def test_consent_is_unique_per_pseudonym(self):
        QuizResearchConsent.objects.create(pseudonym="p1", consent_version="v", granted_at=timezone.now())
        with self.assertRaises(IntegrityError), transaction.atomic():
            QuizResearchConsent.objects.create(pseudonym="p1", consent_version="v", granted_at=timezone.now())

    def test_prediction_fields_are_optional_but_the_rest_is_required(self):
        event = _event("p1", "n1", pred_skill=None, pred_ability=None, p_before=None, p_after=None, ability_before=None)
        event.full_clean()

    def test_the_fastapi_table_definition_matches_the_django_model(self):
        # fastAPI/routes/quiz/research_events.py 手動組的 Table 要跟這兩個 model 的欄位與必填一致
        from fastAPI.routes.quiz import research_events as E
        for table, model in ((E._events, QuizSkillEvent), (E._consent, QuizResearchConsent)):
            django_fields = {f.column: f for f in model._meta.concrete_fields}
            self.assertEqual({c.name for c in table.columns}, set(django_fields), table.name)
            for column in table.columns:
                if column.primary_key:
                    continue
                self.assertEqual(not column.nullable, not django_fields[column.name].null, f"{table.name}.{column.name}")
        self.assertEqual(E._events.name, QuizSkillEvent._meta.db_table)
        self.assertEqual(E._consent.name, QuizResearchConsent._meta.db_table)


class PurgeServiceTests(TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {QR.SALT_ENV: SALT})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.alice, self.bob = QR.pseudonym("alice"), QR.pseudonym("bob")
        for p in (self.alice, self.bob):
            QuizResearchConsent.objects.create(pseudonym=p, consent_version=QR.CONSENT_VERSION, granted_at=timezone.now())
        _event(self.alice, "a1")
        _event(self.alice, "a2")
        _event(self.bob, "b1")

    def test_purge_user_deletes_only_that_users_events_and_revokes_consent(self):
        result = svc.purge_user("alice")
        self.assertEqual(result, {"events_deleted": 2, "consent_revoked": 1})
        self.assertEqual(list(QuizSkillEvent.objects.values_list("pseudonym", flat=True)), [self.bob])
        self.assertIsNotNone(QuizResearchConsent.objects.get(pseudonym=self.alice).revoked_at)
        self.assertIsNone(QuizResearchConsent.objects.get(pseudonym=self.bob).revoked_at)

    def test_purge_is_idempotent(self):
        svc.purge_user("alice")
        self.assertEqual(svc.purge_user("alice"), {"events_deleted": 0, "consent_revoked": 0})

    def test_purge_user_without_a_salt_is_skipped_not_a_crash(self):
        with mock.patch.dict(os.environ, {QR.SALT_ENV: ""}):
            self.assertIn("skipped", svc.purge_user("alice"))
        self.assertEqual(QuizSkillEvent.objects.count(), 3)

    def test_purge_of_an_unknown_user_changes_nothing(self):
        self.assertEqual(svc.purge_user("nobody"), {"events_deleted": 0, "consent_revoked": 0})
        self.assertEqual(QuizSkillEvent.objects.count(), 3)

    def test_purge_older_than(self):
        QuizSkillEvent.objects.filter(nonce="a1").update(occurred_at=timezone.now() - timedelta(days=200))
        QuizSkillEvent.objects.filter(nonce="b1").update(occurred_at=timezone.now() - timedelta(days=180, minutes=-5))
        self.assertEqual(svc.purge_older_than(180), 1)
        self.assertEqual(set(QuizSkillEvent.objects.values_list("nonce", flat=True)), {"a2", "b1"})

    def test_purge_older_than_rejects_nonsense(self):
        for days in (0, -3):
            with self.assertRaises(ValueError):
                svc.purge_older_than(days)


class PurgeCommandTests(TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {QR.SALT_ENV: SALT})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.alice = QR.pseudonym("alice")
        _event(self.alice, "a1")
        _event(self.alice, "a2")
        _event(QR.pseudonym("bob"), "b1")

    def _run(self, *args):
        out = io.StringIO()
        call_command("purge_quiz_research_data", *args, stdout=out)
        return out.getvalue()

    def test_default_is_a_dry_run(self):
        self.assertIn("預覽：會刪除這位使用者的 2 筆事件", self._run("--uid", "alice"))
        self.assertEqual(QuizSkillEvent.objects.count(), 3)

    def test_yes_deletes(self):
        self.assertIn("已刪除 2 筆事件", self._run("--uid", "alice", "--yes"))
        self.assertEqual(QuizSkillEvent.objects.count(), 1)

    def test_retention_dry_run_and_delete(self):
        QuizSkillEvent.objects.filter(nonce="a1").update(occurred_at=timezone.now() - timedelta(days=400))
        self.assertIn("預覽：會刪除 1 筆超過 365 天", self._run("--older-than-days", "365"))
        self.assertEqual(QuizSkillEvent.objects.count(), 3)
        self.assertIn("已刪除 1 筆超過 365 天", self._run("--older-than-days", "365", "--yes"))
        self.assertEqual(QuizSkillEvent.objects.count(), 2)

    def test_exactly_one_selector_is_required(self):
        with self.assertRaises(CommandError):
            self._run()
        with self.assertRaises(CommandError):
            self._run("--uid", "alice", "--older-than-days", "30")

    def test_uid_needs_the_salt(self):
        with mock.patch.dict(os.environ, {QR.SALT_ENV: ""}), self.assertRaises(CommandError):
            self._run("--uid", "alice", "--yes")
        self.assertEqual(QuizSkillEvent.objects.count(), 3)

    def test_retention_must_be_positive(self):
        with self.assertRaises(CommandError):
            self._run("--older-than-days", "0")


class AccountDeletionTests(TestCase):
    """刪除帳號時，詞素學習的伺服器端狀態（Firestore 子集合）與假名化的研究事件也要一併清除。"""

    def setUp(self):
        from django.core.cache import cache
        from django.test import Client
        self.client = Client()
        patcher = mock.patch.dict(os.environ, {QR.SALT_ENV: SALT})
        patcher.start()
        self.addCleanup(patcher.stop)
        # 刪除帳號端點依 uid 限速（計數存在 Django cache）；這裡每個測試都刪同一個帳號，
        # 前後都要清掉計數，才不會被別的測試的呼叫次數影響，也不影響別人。
        cache.clear()
        self.addCleanup(cache.clear)
        self.calls = []                                   # 記錄呼叫順序：撤銷登入必須在清資料之前
        self.revoke_error = None
        revoke = mock.patch("adminapi.firebase_ops.revoke_sessions", side_effect=self._revoke)
        revoke.start()
        self.addCleanup(revoke.stop)
        real_purge = svc.purge_user
        purge = mock.patch.object(svc, "purge_user", side_effect=lambda uid: (self.calls.append("purge"), real_purge(uid))[1])
        purge.start()
        self.addCleanup(purge.stop)

    def _revoke(self, uid):
        self.calls.append("revoke")
        if self.revoke_error:
            raise self.revoke_error

    def _delete(self, state_snaps, users_doc_ref_configure=None):
        from adminapi.test_users import _as_role, _build_client_router, _fake_snapshot, _fake_user_record, _post_json
        from config.roles import OWNER
        users_doc = _fake_snapshot("uid1", {"name": "Alice"})
        client, users_doc_ref = _build_client_router(users_doc=users_doc, notes=[], recordings=[])
        users_doc_ref.collection.return_value.stream.return_value = state_snaps
        if users_doc_ref_configure:
            users_doc_ref_configure(users_doc_ref)
        with mock.patch("adminapi.firebase_ops.get_firebase_user", return_value=_fake_user_record("uid1", email="alice@example.com")), \
             mock.patch("adminapi.firebase_ops.get_firestore_client", return_value=client), \
             mock.patch("adminapi.firebase_ops.delete_firebase_user"), \
             _as_role(OWNER) as headers:
            resp = _post_json(self.client, "/adminapi/users/uid1/delete/", headers, {"confirm_email": "alice@example.com"})
        return resp, users_doc_ref

    def test_rule_state_documents_and_research_events_are_removed(self):
        pseud = QR.pseudonym("uid1")
        QuizResearchConsent.objects.create(pseudonym=pseud, consent_version=QR.CONSENT_VERSION, granted_at=timezone.now())
        _event(pseud, "n1")
        _event(QR.pseudonym("other"), "n2")
        snaps = [mock.MagicMock(), mock.MagicMock()]
        resp, users_doc_ref = self._delete(snaps)
        results = resp.json()["results"]
        self.assertEqual(resp.status_code, 200)
        users_doc_ref.collection.assert_called_with("quizRuleState")
        for snap in snaps:
            snap.reference.delete.assert_called_once()
        self.assertEqual(results["quiz_rule_state"], {"deleted": 2})
        self.assertEqual(results["quiz_research"], {"events_deleted": 1, "consent_revoked": 1})
        self.assertEqual(list(QuizSkillEvent.objects.values_list("nonce", flat=True)), ["n2"])
        users_doc_ref.delete.assert_called_once()

    def test_logins_are_revoked_before_any_data_is_purged(self):
        # 沒有同意紀錄時資料庫沒有列可以鎖；先撤銷登入，清除期間這個帳號就不能再同意或寫事件
        resp, _ = self._delete([])
        assert_equal = self.assertEqual
        assert_equal(self.calls, ["revoke", "purge"])
        assert_equal(resp.json()["results"]["sessions_revoked"], {"revoked": True})

    def test_a_failure_revoking_logins_is_reported_but_the_deletion_continues(self):
        self.revoke_error = RuntimeError("firebase down")
        resp, users_doc_ref = self._delete([])
        results = resp.json()["results"]
        self.assertFalse(results["sessions_revoked"]["revoked"])
        self.assertIn("error", results["sessions_revoked"])
        self.assertIn("quiz_research", results)
        users_doc_ref.delete.assert_called_once()

    def test_a_failure_cleaning_rule_state_is_reported_and_does_not_stop_the_rest(self):
        def boom(ref):
            ref.collection.return_value.stream.side_effect = RuntimeError("firestore down")
        resp, users_doc_ref = self._delete([], users_doc_ref_configure=boom)
        results = resp.json()["results"]
        self.assertEqual(results["quiz_rule_state"]["deleted"], 0)
        self.assertIn("error", results["quiz_rule_state"])
        self.assertTrue(results["firestore_user_document"]["deleted"])
        users_doc_ref.delete.assert_called_once()

    def test_a_failure_purging_research_events_is_reported_and_does_not_stop_the_rest(self):
        svc.purge_user.side_effect = RuntimeError("db down")
        resp, users_doc_ref = self._delete([])
        results = resp.json()["results"]
        self.assertIn("error", results["quiz_research"])
        self.assertTrue(results["firestore_user_document"]["deleted"])
        users_doc_ref.delete.assert_called_once()

    def test_without_a_salt_the_research_purge_is_skipped_but_the_deletion_succeeds(self):
        with mock.patch.dict(os.environ, {QR.SALT_ENV: ""}):
            resp, _ = self._delete([])
        self.assertEqual(resp.status_code, 200)
        self.assertIn("skipped", resp.json()["results"]["quiz_research"])
