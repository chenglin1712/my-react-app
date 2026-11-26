"""稽核 WP-8 驗證：辭典草稿的所有權（PUT／DELETE／submit／withdraw），以及文法新建提案清單。"""
from django.core.cache import cache
from django.test import Client

from config.roles import ADMIN, EDITOR, OWNER

from .dictionary_test_base import DictionaryDbTestCase
from .models import DictionaryRevision
from .test_dictionary_words import _MINIMAL_WORD_PAYLOAD, _post_json_raw, _put_json
from .test_wp8_dictionary import _as_user


class DraftOwnershipTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = Client()
        self.seed_tribe()
        self.word_id = self.seed_word(name="target")

    def _rev(self, created_by="alice", status=DictionaryRevision.STATUS_DRAFT, submitted_by=""):
        return DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_WORD, target_id=self.word_id, tribe="tayal",
            operation=DictionaryRevision.OPERATION_UPDATE,
            payload=dict(_MINIMAL_WORD_PAYLOAD, name="target"),
            status=status, created_by=created_by, submitted_by=submitted_by,
        )

    def _put(self, rev, role, uid):
        with _as_user(role, uid=uid) as headers:
            return _put_json(self.client, f"/adminapi/dictionary/revisions/{rev.pk}/", headers,
                             dict(_MINIMAL_WORD_PAYLOAD, name="changed"))

    def _delete(self, rev, role, uid):
        with _as_user(role, uid=uid) as headers:
            return self.client.delete(f"/adminapi/dictionary/revisions/{rev.pk}/", **headers)

    def _action(self, rev, action, role, uid):
        with _as_user(role, uid=uid) as headers:
            return _post_json_raw(self.client, f"/adminapi/dictionary/revisions/{rev.pk}/{action}/", headers)

    def test_other_editor_cannot_put_discard_or_submit(self):
        rev = self._rev()
        put = self._put(rev, EDITOR, "bob")
        discard = self._delete(rev, EDITOR, "bob")
        submit = self._action(rev, "submit", EDITOR, "bob")
        self.assertEqual([put.status_code, discard.status_code, submit.status_code], [403, 403, 403])
        self.assertEqual(put.json()["code"], "not_draft_owner")
        rev.refresh_from_db()
        self.assertEqual(rev.payload["name"], "target")
        self.assertEqual(rev.status, DictionaryRevision.STATUS_DRAFT)

    def test_creator_can_put_submit(self):
        rev = self._rev()
        self.assertEqual(self._put(rev, EDITOR, "alice").status_code, 200)
        self.assertEqual(self._action(rev, "submit", EDITOR, "alice").status_code, 200)

    def test_creator_can_discard(self):
        rev = self._rev()
        self.assertEqual(self._delete(rev, EDITOR, "alice").status_code, 200)
        self.assertFalse(DictionaryRevision.objects.filter(pk=rev.pk).exists())

    def test_publishers_can_operate_on_others_drafts(self):
        rev = self._rev()
        self.assertEqual(self._put(rev, ADMIN, "admin-1").status_code, 200)
        self.assertEqual(self._action(rev, "submit", OWNER, "owner-1").status_code, 200)
        self.assertEqual(self._action(rev, "withdraw", ADMIN, "admin-1").status_code, 200)
        self.assertEqual(self._delete(rev, OWNER, "owner-1").status_code, 200)

    def test_withdraw_limited_to_creator_submitter_or_publishers(self):
        rev = self._rev(status=DictionaryRevision.STATUS_PENDING_REVIEW, submitted_by="carol")
        self.assertEqual(self._action(rev, "withdraw", EDITOR, "bob").status_code, 403)
        rev.refresh_from_db()
        self.assertEqual(rev.status, DictionaryRevision.STATUS_PENDING_REVIEW)
        # 送審者本人可以撤回
        self.assertEqual(self._action(rev, "withdraw", EDITOR, "carol").status_code, 200)

    def test_creator_can_withdraw(self):
        rev = self._rev(status=DictionaryRevision.STATUS_PENDING_REVIEW, submitted_by="alice")
        self.assertEqual(self._action(rev, "withdraw", EDITOR, "alice").status_code, 200)


class NewGrammarRevisionListTest(DictionaryDbTestCase):
    """FE7a-02 文法部分：?revisions=new&kind=grammar_section 列出自己的新建章節草稿＋所有送審中的。"""

    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = Client()

    def _create(self, created_by, status, kind=DictionaryRevision.TARGET_GRAMMAR_SECTION):
        return DictionaryRevision.objects.create(
            target_kind=kind, target_id="", tribe="tayal",
            operation=DictionaryRevision.OPERATION_CREATE, payload={"title": "x"}, title_cache="章節",
            status=status, created_by=created_by,
        )

    def test_lists_only_grammar_creates_visible_to_me(self):
        mine = self._create("me", DictionaryRevision.STATUS_DRAFT)
        others_draft = self._create("other", DictionaryRevision.STATUS_DRAFT)
        pending = self._create("other", DictionaryRevision.STATUS_PENDING_REVIEW)
        word_create = self._create("me", DictionaryRevision.STATUS_DRAFT, kind=DictionaryRevision.TARGET_WORD)
        with _as_user(EDITOR, uid="me") as headers:
            body = self.client.get(
                "/adminapi/dictionary/words/?revisions=new&kind=grammar_section", **headers,
            ).json()
        ids = {row["id"] for row in body["results"]}
        self.assertEqual(ids, {mine.pk, pending.pk})
        self.assertNotIn(others_draft.pk, ids)
        self.assertNotIn(word_create.pk, ids)

    def test_unknown_kind_is_400(self):
        with _as_user(EDITOR, uid="me") as headers:
            resp = self.client.get("/adminapi/dictionary/words/?revisions=new&kind=evil", **headers)
        self.assertEqual(resp.status_code, 400)
