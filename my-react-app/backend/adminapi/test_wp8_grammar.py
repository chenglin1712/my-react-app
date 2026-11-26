"""稽核 WP-8（FE7a-01／FE7a-02）：文法章節的草稿載入與提案防護，以及送審佇列連結。"""
from unittest.mock import patch

from django.core.cache import cache
from django.test import Client

from config.roles import EDITOR, REVIEWER

from .models import DictionaryRevision
from .test_dictionary_grammar import (
    _MINIMAL_SECTION_PAYLOAD, DictionaryDbTestCase, _as_role, _current_content_hash, _post_json, _post_json_raw,
)


class GrammarDraftGuardsTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = Client()
        self.seed_tribe()
        with _as_role(EDITOR) as headers:
            created = _post_json(self.client, "/adminapi/dictionary/grammar/sections/", headers, _MINIMAL_SECTION_PAYLOAD)
        revision_id = created.json()["revision_id"]
        with _as_role(EDITOR) as headers:
            _post_json_raw(self.client, f"/adminapi/dictionary/revisions/{revision_id}/submit/", headers)
        with _as_role(REVIEWER) as headers:
            approved = _post_json_raw(self.client, f"/adminapi/dictionary/revisions/{revision_id}/approve/", headers)
        self.section_id = approved.json()["target_id"]
        self.url = f"/adminapi/dictionary/grammar/sections/{self.section_id}/propose/"

    def _open(self):
        return DictionaryRevision.objects.filter(
            target_id=self.section_id, status__in=[DictionaryRevision.STATUS_DRAFT, DictionaryRevision.STATUS_PENDING_REVIEW],
        )

    def _propose(self):
        body = {**_MINIMAL_SECTION_PAYLOAD, "base_hash": _current_content_hash(self.section_id)}
        with _as_role(EDITOR) as headers:
            return _post_json_raw(self.client, self.url, headers, body)

    def test_detail_returns_the_open_draft_so_reload_does_not_lose_it(self):
        self.assertEqual(self._propose().status_code, 201)
        with _as_role(EDITOR) as headers:
            meta = self.client.get(f"/adminapi/dictionary/grammar/sections/{self.section_id}/", **headers).json()["meta"]
        self.assertIsNone(meta["pending_revision"])  # 草稿不是送審中
        self.assertEqual(meta["open_revision"]["status"], "draft")

    def test_a_delete_draft_is_not_overwritten_by_propose(self):
        DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_GRAMMAR_SECTION, target_id=self.section_id, tribe="tayal",
            operation=DictionaryRevision.OPERATION_DELETE, payload={},
            status=DictionaryRevision.STATUS_DRAFT, created_by="test-uid",
        )
        self.assertEqual(self._propose().status_code, 409)
        self.assertEqual(self._open().get().operation, DictionaryRevision.OPERATION_DELETE)

    def test_someone_elses_draft_is_not_overwritten(self):
        # WP-8 追加：與 PUT 同規則，非建立者的編輯者改回 403 not_draft_owner（原本是 409）
        DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_GRAMMAR_SECTION, target_id=self.section_id, tribe="tayal",
            operation=DictionaryRevision.OPERATION_UPDATE, payload={"title": "別人的"},
            status=DictionaryRevision.STATUS_DRAFT, created_by="someone-else",
        )
        resp = self._propose()
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["code"], "not_draft_owner")
        self.assertEqual(self._open().get().payload, {"title": "別人的"})

    def test_own_draft_is_reused(self):
        self.assertEqual(self._propose().status_code, 201)
        self.assertEqual(self._propose().status_code, 200)
        self.assertEqual(self._open().count(), 1)

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_review_queue_links_to_the_revision_itself(self, mock_client_fn):
        # 檢舉那一路會讀 Firestore，CI 沒有服務帳戶金鑰，這裡只關心辭典提案的連結
        mock_client_fn.return_value.collection.return_value.where.return_value.stream.return_value = []
        proposed = self._propose().json()["revision_id"]
        with _as_role(EDITOR) as headers:
            _post_json_raw(self.client, f"/adminapi/dictionary/revisions/{proposed}/submit/", headers)
        with _as_role(REVIEWER) as headers:
            queue = self.client.get("/adminapi/review-queue/", **headers).json()
        links = [item["link"] for item in queue["results"] if item["type"] == "revision"]
        self.assertIn(f"/admin/dictionary/revisions/{proposed}", links)
