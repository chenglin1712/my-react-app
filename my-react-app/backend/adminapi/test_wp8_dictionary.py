"""稽核 WP-8：辭典編輯器相關的後端修正（FE7a-01/02/06/07、BE1-03 的前端配套欄位）。"""
from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.test import Client
from django.test.utils import override_settings

from adminapi.auth_fixtures import fresh_auth
from config.roles import ADMIN, EDITOR, OWNER, REVIEWER
from dictionary_db import connect as connect_module
from dictionary_db import model as m

from .dictionary_test_base import DictionaryDbTestCase
from .models import DictionaryRevision
from .test_dictionary_words import _MINIMAL_WORD_PAYLOAD, _post_json, _post_json_raw, _put_json


@contextmanager
def _as_user(role, uid="test-uid"):
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": uid, "role": role}
            with patch("firebase_admin.auth.verify_id_token", return_value=fresh_auth(decoded)):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


class _Base(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = Client()
        self.seed_tribe()
        self.word_id = self.seed_word(name="target")

    def _draft(self, operation=DictionaryRevision.OPERATION_UPDATE, payload=None, created_by="test-uid",
               target_id=None, status=DictionaryRevision.STATUS_DRAFT):
        return DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_WORD,
            target_id=self.word_id if target_id is None else target_id, tribe="tayal",
            operation=operation,
            payload=payload if payload is not None else dict(_MINIMAL_WORD_PAYLOAD, name="target"),
            status=status, created_by=created_by,
        )

    def _seed_reference(self):
        db = connect_module.SessionLocal()
        try:
            db.add(m.Word(id="word-other", tribe_id="tribe-tayal", name="other"))
            exp = m.WordExplanation(word_id="word-other", sort_order=0, chinese_explanation="x")
            db.add(exp)
            db.flush()
            sent = m.WordExplanationSentence(explanation_id=exp.id, sort_order=0, original_sentence="s")
            db.add(sent)
            db.flush()
            ana = m.WordExplanationAnaphora(sentence_id=sent.id, sort_order=0)
            db.add(ana)
            db.flush()
            db.add(m.WordExplanationAnaphoraItem(anaphora_id=ana.id, word_id=self.word_id, name="target", sort_order=0))
            db.commit()
        finally:
            db.close()


class WordDetailOpenRevisionTest(_Base):
    """稽核 FE7a-01：詳情要回傳草稿，編輯器才能載入，而不是重新載入後看不見。"""

    def test_detail_reports_draft_in_open_revision_but_not_pending_revision(self):
        draft = self._draft()
        with _as_user(EDITOR) as headers:
            body = self.client.get(f"/adminapi/dictionary/words/{self.word_id}/", **headers).json()
        self.assertIsNone(body["meta"]["pending_revision"])
        self.assertEqual(body["meta"]["open_revision"]["id"], draft.pk)
        self.assertEqual(body["meta"]["open_revision"]["status"], "draft")
        self.assertEqual(body["meta"]["open_revision"]["created_by"], "test-uid")
        self.assertIn("updated_at", body["meta"]["open_revision"])

    def test_detail_reports_pending_review_in_both(self):
        rev = self._draft(status=DictionaryRevision.STATUS_PENDING_REVIEW)
        with _as_user(EDITOR) as headers:
            body = self.client.get(f"/adminapi/dictionary/words/{self.word_id}/", **headers).json()
        self.assertEqual(body["meta"]["pending_revision"]["id"], rev.pk)
        self.assertEqual(body["meta"]["open_revision"]["id"], rev.pk)

    def test_detail_without_revision_has_null_open_revision(self):
        with _as_user(EDITOR) as headers:
            body = self.client.get(f"/adminapi/dictionary/words/{self.word_id}/", **headers).json()
        self.assertIsNone(body["meta"]["open_revision"])

    def test_revision_get_includes_creator_and_title(self):
        draft = self._draft()
        with _as_user(REVIEWER) as headers:
            body = self.client.get(f"/adminapi/dictionary/revisions/{draft.pk}/", **headers).json()
        self.assertEqual(body["created_by"], "test-uid")
        self.assertEqual(body["title"], draft.title_cache)
        self.assertNotIn("reference_counts", body)


class NewWordRevisionListTest(_Base):
    """稽核 FE7a-02：新建提案沒有 word_id，要有地方列出來才回得去。"""

    def test_lists_own_create_drafts_and_all_pending_creates_but_not_others_drafts(self):
        mine = self._draft(operation=DictionaryRevision.OPERATION_CREATE, target_id="", created_by="me")
        others_draft = self._draft(operation=DictionaryRevision.OPERATION_CREATE, target_id="", created_by="other")
        others_pending = self._draft(
            operation=DictionaryRevision.OPERATION_CREATE, target_id="", created_by="other",
            status=DictionaryRevision.STATUS_PENDING_REVIEW,
        )
        self._draft()  # 既有詞條的更新草稿不列在這裡
        with _as_user(EDITOR, uid="me") as headers:
            body = self.client.get("/adminapi/dictionary/words/?revisions=new", **headers).json()
        ids = {row["id"] for row in body["results"]}
        self.assertEqual(ids, {mine.pk, others_pending.pk})
        self.assertNotIn(others_draft.pk, ids)
        mine_row = next(row for row in body["results"] if row["id"] == mine.pk)
        self.assertTrue(mine_row["mine"])

    def test_create_response_includes_updated_at(self):
        with _as_user(EDITOR) as headers:
            resp = _post_json(self.client, "/adminapi/dictionary/words/", headers, _MINIMAL_WORD_PAYLOAD)
        self.assertEqual(resp.status_code, 201)
        self.assertIn("updated_at", resp.json())


class DraftPutOptimisticLockTest(_Base):
    """稽核 FE7a-06：草稿 PUT 帶 base_updated_at 時做樂觀鎖。"""

    def test_put_with_matching_base_updated_at_succeeds_and_returns_new_updated_at(self):
        draft = self._draft()
        payload = dict(_MINIMAL_WORD_PAYLOAD, name="target", base_updated_at=draft.updated_at.isoformat())
        with _as_user(EDITOR) as headers:
            resp = _put_json(self.client, f"/adminapi/dictionary/revisions/{draft.pk}/", headers, payload)
        self.assertEqual(resp.status_code, 200)
        draft.refresh_from_db()
        self.assertNotIn("base_updated_at", draft.payload)
        self.assertEqual(resp.json()["updated_at"], draft.updated_at.isoformat())

    def test_put_with_stale_base_updated_at_is_409_and_does_not_write(self):
        draft = self._draft()
        stale = (draft.updated_at - timedelta(seconds=5)).isoformat()
        payload = dict(_MINIMAL_WORD_PAYLOAD, name="changed", base_updated_at=stale)
        with _as_user(EDITOR) as headers:
            resp = _put_json(self.client, f"/adminapi/dictionary/revisions/{draft.pk}/", headers, payload)
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["code"], "edit_conflict")
        draft.refresh_from_db()
        self.assertEqual(draft.payload["name"], "target")

    def test_put_with_malformed_base_updated_at_is_400(self):
        draft = self._draft()
        payload = dict(_MINIMAL_WORD_PAYLOAD, name="target", base_updated_at="not-a-date")
        with _as_user(EDITOR) as headers:
            resp = _put_json(self.client, f"/adminapi/dictionary/revisions/{draft.pk}/", headers, payload)
        self.assertEqual(resp.status_code, 400)

    def test_put_without_base_updated_at_keeps_old_behaviour(self):
        draft = self._draft()
        with _as_user(EDITOR) as headers:
            resp = _put_json(self.client, f"/adminapi/dictionary/revisions/{draft.pk}/", headers,
                             dict(_MINIMAL_WORD_PAYLOAD, name="target"))
        self.assertEqual(resp.status_code, 200)


class UnlinkReferencesRoleTest(_Base):
    """稽核 FE7a-07：unlink_references=true 只允許 owner／admin 提出（建立、更新兩處）；
    WP-8 追加：核准端點不再限制角色。"""

    def test_editor_cannot_create_unlinking_delete_proposal(self):
        with _as_user(EDITOR) as headers:
            resp = _post_json(self.client, f"/adminapi/dictionary/words/{self.word_id}/delete-proposal/", headers,
                              {"unlink_references": True})
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(DictionaryRevision.objects.exists())

    def test_editor_can_still_create_plain_delete_proposal(self):
        with _as_user(EDITOR) as headers:
            resp = _post_json(self.client, f"/adminapi/dictionary/words/{self.word_id}/delete-proposal/", headers,
                              {"unlink_references": False})
        self.assertEqual(resp.status_code, 201)
        self.assertIn("updated_at", resp.json())

    def test_admin_can_create_unlinking_delete_proposal(self):
        with _as_user(ADMIN) as headers:
            resp = _post_json(self.client, f"/adminapi/dictionary/words/{self.word_id}/delete-proposal/", headers,
                              {"unlink_references": True})
        self.assertEqual(resp.status_code, 201)

    def test_editor_cannot_turn_on_unlink_via_put(self):
        draft = self._draft(operation=DictionaryRevision.OPERATION_DELETE, payload={"unlink_references": False})
        with _as_user(EDITOR) as headers:
            resp = _put_json(self.client, f"/adminapi/dictionary/revisions/{draft.pk}/", headers,
                             {"unlink_references": True})
        self.assertEqual(resp.status_code, 403)
        draft.refresh_from_db()
        self.assertEqual(draft.payload, {"unlink_references": False})

    def test_reviewer_can_approve_unlinking_proposal(self):
        """WP-8 追加：限制只在提出端，reviewer 可以核准帶 unlink_references=true 的刪除提案
        （原本這裡測的是 reviewer 核准被 403 擋下）。"""
        self._seed_reference()
        rev = self._draft(operation=DictionaryRevision.OPERATION_DELETE, payload={"unlink_references": True},
                          status=DictionaryRevision.STATUS_PENDING_REVIEW)
        with _as_user(REVIEWER) as headers:
            resp = _post_json_raw(self.client, f"/adminapi/dictionary/revisions/{rev.pk}/approve/", headers, {})
        self.assertEqual(resp.status_code, 200)
        rev.refresh_from_db()
        self.assertEqual(rev.status, DictionaryRevision.STATUS_APPROVED)
        db = connect_module.SessionLocal()
        try:
            self.assertIsNone(db.query(m.Word).filter(m.Word.id == self.word_id).first())
            # 引用一併解除：其他詞條的指代項目不再指向被刪的詞條
            self.assertEqual(
                db.query(m.WordExplanationAnaphoraItem).filter(
                    m.WordExplanationAnaphoraItem.word_id == self.word_id,
                ).count(),
                0,
            )
        finally:
            db.close()

    def test_editor_still_cannot_approve(self):
        """核准端點本身仍只開放給審核角色（CONTENT_APPROVERS）。"""
        rev = self._draft(operation=DictionaryRevision.OPERATION_DELETE, payload={"unlink_references": True},
                          status=DictionaryRevision.STATUS_PENDING_REVIEW)
        with _as_user(EDITOR) as headers:
            resp = _post_json_raw(self.client, f"/adminapi/dictionary/revisions/{rev.pk}/approve/", headers, {})
        self.assertEqual(resp.status_code, 403)

    def test_owner_can_approve_unlinking_proposal(self):
        self._seed_reference()
        rev = self._draft(operation=DictionaryRevision.OPERATION_DELETE, payload={"unlink_references": True},
                          status=DictionaryRevision.STATUS_PENDING_REVIEW)
        with _as_user(OWNER) as headers:
            resp = _post_json_raw(self.client, f"/adminapi/dictionary/revisions/{rev.pk}/approve/", headers, {})
        self.assertEqual(resp.status_code, 200)

    def test_reviewer_can_approve_plain_delete(self):
        rev = self._draft(operation=DictionaryRevision.OPERATION_DELETE, payload={"unlink_references": False},
                          status=DictionaryRevision.STATUS_PENDING_REVIEW)
        with _as_user(REVIEWER) as headers:
            resp = _post_json_raw(self.client, f"/adminapi/dictionary/revisions/{rev.pk}/approve/", headers, {})
        self.assertEqual(resp.status_code, 200)

    def test_revision_get_of_word_delete_reports_reference_counts(self):
        self._seed_reference()
        rev = self._draft(operation=DictionaryRevision.OPERATION_DELETE, payload={"unlink_references": True})
        with _as_user(REVIEWER) as headers:
            body = self.client.get(f"/adminapi/dictionary/revisions/{rev.pk}/", **headers).json()
        self.assertEqual(body["reference_counts"]["anaphora_items"], 1)


class ApproveWithViewedVersionTest(_Base):
    """BE1-03 前端配套：核准帶審核者載入時的 updated_at；revision 在審核期間被改過要 409。"""

    def test_approve_with_stale_base_updated_at_is_409_and_keeps_pending(self):
        rev = self._draft(operation=DictionaryRevision.OPERATION_DELETE, payload={"unlink_references": False},
                          status=DictionaryRevision.STATUS_PENDING_REVIEW)
        stale = (rev.updated_at - timedelta(seconds=5)).isoformat()
        with _as_user(REVIEWER) as headers:
            resp = _post_json_raw(self.client, f"/adminapi/dictionary/revisions/{rev.pk}/approve/", headers,
                                  {"base_updated_at": stale})
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["code"], "edit_conflict")
        rev.refresh_from_db()
        self.assertEqual(rev.status, DictionaryRevision.STATUS_PENDING_REVIEW)

    def test_submit_and_withdraw_return_updated_at(self):
        draft = self._draft()
        with _as_user(EDITOR) as headers:
            submitted = _post_json_raw(self.client, f"/adminapi/dictionary/revisions/{draft.pk}/submit/", headers)
            withdrawn = _post_json_raw(self.client, f"/adminapi/dictionary/revisions/{draft.pk}/withdraw/", headers)
        self.assertIn("updated_at", submitted.json())
        draft.refresh_from_db()
        self.assertEqual(withdrawn.json()["updated_at"], draft.updated_at.isoformat())
