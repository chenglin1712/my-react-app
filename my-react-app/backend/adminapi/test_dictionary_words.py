"""P4.1 詞條 CRUD：角色門檻、送審流程、對帳寫入正確性、引用防線。

跟其他 adminapi 測試不同的地方：辭典資料活在 dictionary_db（SQLAlchemy
直連），不是 Django ORM，所以繼承 DictionaryDbTestCase（見該檔案說明）
而不是普通的 TestCase——這裡要測的正是「SQL 本身對不對」（對帳保留 id、
刪除的子節點真的被刪、跨族語參照被擋下），不能用 MagicMock 頂替，因為
MagicMock 只能斷言「有呼叫 .filter()」，證明不了這些。
"""
import json
from contextlib import contextmanager
from unittest.mock import patch

from django.test import Client
from django.test.utils import override_settings

from config.roles import ADMIN, ANALYST, EDITOR, OWNER, REVIEWER
from dictionary_db import connect as connect_module
from dictionary_db import model as m

from .dictionary_test_base import DictionaryDbTestCase
from .models import AuditLog, DictionaryRevision


@contextmanager
def _as_role(role):
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("config.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": "test-uid"}
            if role is not None:
                decoded["role"] = role
            with patch("firebase_admin.auth.verify_id_token", return_value=decoded):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _post_json(client, url, headers, payload=None):
    return client.post(url, data=json.dumps(payload or {}), content_type="application/json", **headers)


def _put_json(client, url, headers, payload=None):
    return client.put(url, data=json.dumps(payload or {}), content_type="application/json", **headers)


_MINIMAL_WORD_PAYLOAD = {
    "tribe_id": "tribe-tayal",
    "name": "huzil",
    "explanations": [
        {
            "chinese_explanation": "狗",
            "category_ids": [], "pos_ids": [], "focus_ids": [],
            "images": [], "sentences": [],
        },
    ],
}


class WordCreateFlowTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        self.client = Client()
        self.seed_tribe()

    def test_analyst_cannot_create(self):
        with _as_role(ANALYST) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/words/', headers, _MINIMAL_WORD_PAYLOAD)
        self.assertEqual(resp.status_code, 403)

    def test_no_role_cannot_list(self):
        with _as_role(None) as headers:
            resp = self.client.get('/adminapi/dictionary/words/', **headers)
        self.assertEqual(resp.status_code, 403)

    def test_editor_creates_draft_proposal_not_written_to_dictionary_db(self):
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/words/', headers, _MINIMAL_WORD_PAYLOAD)
        self.assertEqual(resp.status_code, 201)
        revision_id = resp.json()["revision_id"]

        revision = DictionaryRevision.objects.get(pk=revision_id)
        self.assertEqual(revision.status, DictionaryRevision.STATUS_DRAFT)
        self.assertEqual(revision.operation, DictionaryRevision.OPERATION_CREATE)
        self.assertEqual(revision.target_id, "")

        # 草稿完全不落地到辭典 DB——這是整個「未審核內容不能外洩」設計的
        # 核心：不是資料庫裡多一個 status='draft' 的列，是資料庫裡根本沒有它。
        db = connect_module.SessionLocal()
        try:
            self.assertIsNone(db.query(m.Word).filter(m.Word.name == "huzil").first())
        finally:
            db.close()

    def test_missing_required_field_rejected(self):
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/words/', headers, {"tribe_id": "tribe-tayal"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("name", resp.json()["errors"])

    def test_non_integer_taxonomy_id_rejected(self):
        """codex 獨立審查抓到的缺口：category_ids 元素型別不對（例如字串）
        原本只檢查「是不是陣列」就放行，會一路撐到 dictionary_write.py 對
        整數欄位下 IN 查詢時才被資料庫拒絕，變成未攔住的例外而不是乾淨的
        400——_require_int_id_list() 要在請求驗證這一層就攔下來。"""
        payload = {
            **_MINIMAL_WORD_PAYLOAD,
            "explanations": [{**_MINIMAL_WORD_PAYLOAD["explanations"][0], "category_ids": ["1"]}],
        }
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/words/', headers, payload)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("explanations[0].category_ids[0]", resp.json()["errors"])

    def test_boolean_taxonomy_id_rejected(self):
        """Python 的 isinstance(True, int) 是 True，一個誤傳的布林值不該被
        _require_int_id_list() 放行當成合法 id。"""
        payload = {
            **_MINIMAL_WORD_PAYLOAD,
            "explanations": [{**_MINIMAL_WORD_PAYLOAD["explanations"][0], "pos_ids": [True]}],
        }
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/words/', headers, payload)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("explanations[0].pos_ids[0]", resp.json()["errors"])

    def test_non_integer_source_id_rejected(self):
        """source_ids 是詞條頂層欄位（不是巢狀在 explanations 底下），跟
        category_ids/pos_ids/focus_ids 是不同的呼叫點，各自要接上
        _require_int_id_list()。"""
        payload = {**_MINIMAL_WORD_PAYLOAD, "source_ids": ["not-an-id"]}
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/words/', headers, payload)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("source_ids[0]", resp.json()["errors"])

    def test_can_keep_editing_draft_before_submit_via_put(self):
        """新建詞條沒有既有 word_id 可以掛 word_propose，PUT
        /revisions/{id}/ 是唯一能在送審前繼續修改同一筆草稿的路徑（例如
        先存標題，回頭再補解釋內容）。"""
        with _as_role(EDITOR) as headers:
            create_resp = _post_json(self.client, '/adminapi/dictionary/words/', headers, _MINIMAL_WORD_PAYLOAD)
        revision_id = create_resp.json()["revision_id"]

        with _as_role(EDITOR) as headers:
            put_resp = _put_json(
                self.client, f'/adminapi/dictionary/revisions/{revision_id}/', headers,
                {**_MINIMAL_WORD_PAYLOAD, "name": "huzil-updated"},
            )
        self.assertEqual(put_resp.status_code, 200)
        self.assertEqual(put_resp.json()["payload"]["name"], "huzil-updated")

        revision = DictionaryRevision.objects.get(pk=revision_id)
        self.assertEqual(revision.payload["name"], "huzil-updated")
        self.assertEqual(revision.title_cache, "huzil-updated")

    def test_put_rejected_once_pending_review(self):
        with _as_role(EDITOR) as headers:
            create_resp = _post_json(self.client, '/adminapi/dictionary/words/', headers, _MINIMAL_WORD_PAYLOAD)
        revision_id = create_resp.json()["revision_id"]
        with _as_role(EDITOR) as headers:
            _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/submit/', headers)
            put_resp = _put_json(
                self.client, f'/adminapi/dictionary/revisions/{revision_id}/', headers,
                {**_MINIMAL_WORD_PAYLOAD, "name": "should-not-apply"},
            )
        self.assertEqual(put_resp.status_code, 409)

    def test_full_lifecycle_submit_approve_writes_to_dictionary_db(self):
        with _as_role(EDITOR) as headers:
            create_resp = _post_json(self.client, '/adminapi/dictionary/words/', headers, _MINIMAL_WORD_PAYLOAD)
        revision_id = create_resp.json()["revision_id"]

        with _as_role(EDITOR) as headers:
            submit_resp = _post_json(
                self.client, f'/adminapi/dictionary/revisions/{revision_id}/submit/', headers,
            )
        self.assertEqual(submit_resp.json()["status"], "pending_review")

        # editor 送審自己的提案，不能自己核准——跟題庫類內容的既有分工一致
        # （editor 送審，owner/admin/reviewer 才能核准）。
        with _as_role(EDITOR) as headers:
            forbidden_resp = _post_json(
                self.client, f'/adminapi/dictionary/revisions/{revision_id}/approve/', headers,
            )
        self.assertEqual(forbidden_resp.status_code, 403)

        with _as_role(REVIEWER) as headers:
            approve_resp = _post_json(
                self.client, f'/adminapi/dictionary/revisions/{revision_id}/approve/', headers,
            )
        self.assertEqual(approve_resp.status_code, 200)
        new_word_id = approve_resp.json()["target_id"]
        self.assertTrue(new_word_id)

        db = connect_module.SessionLocal()
        try:
            word = db.query(m.Word).filter(m.Word.id == new_word_id).one()
            self.assertEqual(word.name, "huzil")
            explanations = db.query(m.WordExplanation).filter(m.WordExplanation.word_id == new_word_id).all()
            self.assertEqual(len(explanations), 1)
            self.assertEqual(explanations[0].chinese_explanation, "狗")
        finally:
            db.close()

        revision = DictionaryRevision.objects.get(pk=revision_id)
        self.assertEqual(revision.status, DictionaryRevision.STATUS_APPROVED)
        self.assertEqual(revision.target_id, new_word_id)
        self.assertTrue(AuditLog.objects.filter(action="approve_proposal", target_id=new_word_id).exists())

    def test_double_approve_is_idempotent(self):
        """核准是冪等的（整棵樹 PUT 覆蓋，不是逐欄位 patch）——這是選擇
        「聚合覆蓋」而非「增量修改」的核心理由之一：就算 Django 端狀態
        更新在辭典寫入成功之後失敗，重新核准一次結果不變，不會製造
        重複資料。這裡直接呼叫底層函式模擬「同一個提案被套用兩次」，
        不透過 API（API 層本身已經用 status 檢查擋掉重複核准的請求路徑，
        這裡要測的是套用邏輯本身的冪等性質，不是 API 層的狀態機防呆）。"""
        from . import dictionary_write as dw
        from dictionary_db.connect import dictionary_write_session

        with dictionary_write_session() as db:
            word_id_1 = dw.apply_word_tree(db, _MINIMAL_WORD_PAYLOAD, word_id=None)

        with dictionary_write_session() as db:
            word_id_2 = dw.apply_word_tree(db, {**_MINIMAL_WORD_PAYLOAD, "tribe_id": "tribe-tayal"}, word_id=word_id_1)

        self.assertEqual(word_id_1, word_id_2)
        db = connect_module.SessionLocal()
        try:
            explanations = db.query(m.WordExplanation).filter(m.WordExplanation.word_id == word_id_1).all()
            self.assertEqual(len(explanations), 1)  # 沒有因為套用兩次而變成兩筆
        finally:
            db.close()


class WordUpdateFlowTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        self.client = Client()
        self.seed_tribe()
        self.word_id = self.seed_word(name="original")

    def _propose_and_approve(self, headers_editor, headers_approver, payload):
        with _as_role(EDITOR) as headers:
            propose_resp = _post_json(
                self.client, f'/adminapi/dictionary/words/{self.word_id}/propose/', headers, payload,
            )
        revision_id = propose_resp.json()["revision_id"]
        with _as_role(EDITOR) as headers:
            _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/submit/', headers)
        with _as_role(REVIEWER) as headers:
            approve_resp = _post_json(
                self.client, f'/adminapi/dictionary/revisions/{revision_id}/approve/', headers,
            )
        return approve_resp

    def test_update_reconcile_preserves_ids_adds_and_removes_children(self):
        # 先核准一次，建立 2 個解釋。
        first_payload = {
            "tribe_id": "tribe-tayal", "name": "original",
            "explanations": [
                {"chinese_explanation": "解釋一", "category_ids": [], "pos_ids": [], "focus_ids": [], "images": [], "sentences": []},
                {"chinese_explanation": "解釋二", "category_ids": [], "pos_ids": [], "focus_ids": [], "images": [], "sentences": []},
            ],
        }
        self._propose_and_approve(EDITOR, REVIEWER, first_payload)

        db = connect_module.SessionLocal()
        try:
            existing = (
                db.query(m.WordExplanation)
                .filter(m.WordExplanation.word_id == self.word_id)
                .order_by(m.WordExplanation.sort_order).all()
            )
            self.assertEqual(len(existing), 2)
            keep_id, remove_id = existing[0].id, existing[1].id
        finally:
            db.close()

        # 第二次提案：保留第一筆（帶 id）、刪除第二筆（不出現在陣列裡）、新增第三筆（不帶 id）。
        second_payload = {
            "tribe_id": "tribe-tayal", "name": "original",
            "explanations": [
                {"id": keep_id, "chinese_explanation": "解釋一（已修改）", "category_ids": [], "pos_ids": [], "focus_ids": [], "images": [], "sentences": []},
                {"chinese_explanation": "解釋三（新增）", "category_ids": [], "pos_ids": [], "focus_ids": [], "images": [], "sentences": []},
            ],
        }
        approve_resp = self._propose_and_approve(EDITOR, REVIEWER, second_payload)
        self.assertEqual(approve_resp.status_code, 200)

        db = connect_module.SessionLocal()
        try:
            final = (
                db.query(m.WordExplanation)
                .filter(m.WordExplanation.word_id == self.word_id)
                .order_by(m.WordExplanation.sort_order).all()
            )
            self.assertEqual(len(final), 2)
            self.assertEqual(final[0].id, keep_id)  # 保留下來的那筆 id 沒變
            self.assertEqual(final[0].chinese_explanation, "解釋一（已修改）")
            self.assertNotIn(remove_id, [e.id for e in final])  # 被移除的那筆真的不見了
            self.assertEqual(final[1].chinese_explanation, "解釋三（新增）")
        finally:
            db.close()

    def test_base_hash_mismatch_returns_409(self):
        with _as_role(EDITOR) as headers:
            propose_resp = _post_json(
                self.client, f'/adminapi/dictionary/words/{self.word_id}/propose/', headers,
                {**_MINIMAL_WORD_PAYLOAD, "name": "updated", "base_hash": "sha256:stale-value"},
            )
        revision_id = propose_resp.json()["revision_id"]
        with _as_role(EDITOR) as headers:
            _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/submit/', headers)

        with _as_role(REVIEWER) as headers:
            approve_resp = _post_json(
                self.client, f'/adminapi/dictionary/revisions/{revision_id}/approve/', headers,
            )
        self.assertEqual(approve_resp.status_code, 409)

    def test_concurrent_modification_after_lock_reverts_with_apply_error(self):
        """base_hash 快速路徑檢查（見 test_base_hash_mismatch_returns_409）只是
        省一次不必要鎖定寫入的加分項，真正的正確性保證在 apply_word_tree()
        拿到列鎖之後重新比對 expected_hash——這裡不帶 base_hash（跳過快速
        路徑），直接 mock apply_word_tree 丟出 ConcurrentModificationError，
        驗證核准流程走到「認領後才發現套用失敗」的退回分支：revision 回到
        pending_review、apply_error 有內容、辭典 DB 完全沒被動到。"""
        with _as_role(EDITOR) as headers:
            propose_resp = _post_json(
                self.client, f'/adminapi/dictionary/words/{self.word_id}/propose/', headers,
                {**_MINIMAL_WORD_PAYLOAD, "name": "should-not-apply"},
            )
        revision_id = propose_resp.json()["revision_id"]
        with _as_role(EDITOR) as headers:
            _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/submit/', headers)

        from . import dictionary_write as dw
        with patch(
            "adminapi.dictionary_views.dw.apply_word_tree",
            side_effect=dw.ConcurrentModificationError("模擬併發衝突"),
        ):
            with _as_role(REVIEWER) as headers:
                approve_resp = _post_json(
                    self.client, f'/adminapi/dictionary/revisions/{revision_id}/approve/', headers,
                )
        self.assertEqual(approve_resp.status_code, 409)

        revision = DictionaryRevision.objects.get(pk=revision_id)
        self.assertEqual(revision.status, DictionaryRevision.STATUS_PENDING_REVIEW)
        self.assertTrue(revision.apply_error)

        db = connect_module.SessionLocal()
        try:
            self.assertIsNone(db.query(m.Word).filter(m.Word.name == "should-not-apply").first())
        finally:
            db.close()

    def test_cross_tribe_anaphora_link_rejected(self):
        other_tribe = self.seed_tribe(tribe_id="tribe-amis", name="阿美語", slug="amis")
        other_word = self.seed_word(word_id="word-amis-1", tribe_id=other_tribe, name="kolong")

        payload = {
            "tribe_id": "tribe-tayal", "name": "original",
            "explanations": [{
                "chinese_explanation": "測試", "category_ids": [], "pos_ids": [], "focus_ids": [], "images": [],
                "sentences": [{
                    "original_sentence": "s", "audios": [],
                    "anaphoras": [{
                        "is_highlight": False, "is_symbol": False,
                        "items": [{"word_id": other_word, "name": "kolong"}],
                    }],
                }],
            }],
        }
        approve_resp = self._propose_and_approve(EDITOR, REVIEWER, payload)
        self.assertEqual(approve_resp.status_code, 400)

    def test_withdraw_returns_to_draft(self):
        with _as_role(EDITOR) as headers:
            propose_resp = _post_json(
                self.client, f'/adminapi/dictionary/words/{self.word_id}/propose/', headers,
                {**_MINIMAL_WORD_PAYLOAD, "name": "updated"},
            )
        revision_id = propose_resp.json()["revision_id"]
        with _as_role(EDITOR) as headers:
            _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/submit/', headers)
            withdraw_resp = _post_json(
                self.client, f'/adminapi/dictionary/revisions/{revision_id}/withdraw/', headers,
            )
        self.assertEqual(withdraw_resp.json()["status"], "draft")

    def test_reject_requires_comment_and_does_not_touch_dictionary_db(self):
        with _as_role(EDITOR) as headers:
            propose_resp = _post_json(
                self.client, f'/adminapi/dictionary/words/{self.word_id}/propose/', headers,
                {**_MINIMAL_WORD_PAYLOAD, "name": "should-not-apply"},
            )
        revision_id = propose_resp.json()["revision_id"]
        with _as_role(EDITOR) as headers:
            _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/submit/', headers)

        with _as_role(REVIEWER) as headers:
            no_comment_resp = _post_json(
                self.client, f'/adminapi/dictionary/revisions/{revision_id}/reject/', headers, {},
            )
        self.assertEqual(no_comment_resp.status_code, 400)

        with _as_role(REVIEWER) as headers:
            reject_resp = _post_json(
                self.client, f'/adminapi/dictionary/revisions/{revision_id}/reject/', headers,
                {"review_comment": "用字需要再確認"},
            )
        self.assertEqual(reject_resp.json()["status"], "rejected")

        db = connect_module.SessionLocal()
        try:
            word = db.query(m.Word).filter(m.Word.id == self.word_id).one()
            self.assertEqual(word.name, "original")  # 退件後原本的資料完全不受影響
        finally:
            db.close()


class WordDeleteTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        self.client = Client()
        self.seed_tribe()
        self.word_id = self.seed_word(name="target")

    def _seed_referencing_anaphora(self):
        db = connect_module.SessionLocal()
        try:
            other = m.Word(id="word-other", tribe_id="tribe-tayal", name="other")
            db.add(other)
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

    def test_references_endpoint_reports_count(self):
        self._seed_referencing_anaphora()
        with _as_role(EDITOR) as headers:
            resp = self.client.get(f'/adminapi/dictionary/words/{self.word_id}/references/', **headers)
        self.assertEqual(resp.json()["counts"]["anaphora_items"], 1)
        self.assertEqual(len(resp.json()["sample"]), 1)

    def test_delete_blocked_when_referenced(self):
        self._seed_referencing_anaphora()
        with _as_role(EDITOR) as headers:
            propose_resp = _post_json(
                self.client, f'/adminapi/dictionary/words/{self.word_id}/delete-proposal/', headers, {},
            )
        revision_id = propose_resp.json()["revision_id"]
        with _as_role(EDITOR) as headers:
            _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/submit/', headers)
        with _as_role(OWNER) as headers:
            approve_resp = _post_json(
                self.client, f'/adminapi/dictionary/revisions/{revision_id}/approve/', headers,
            )
        self.assertEqual(approve_resp.status_code, 400)

        db = connect_module.SessionLocal()
        try:
            self.assertIsNotNone(db.query(m.Word).filter(m.Word.id == self.word_id).first())
        finally:
            db.close()

    def test_delete_with_unlink_references_succeeds(self):
        self._seed_referencing_anaphora()
        with _as_role(EDITOR) as headers:
            propose_resp = _post_json(
                self.client, f'/adminapi/dictionary/words/{self.word_id}/delete-proposal/', headers,
                {"unlink_references": True},
            )
        revision_id = propose_resp.json()["revision_id"]
        with _as_role(EDITOR) as headers:
            _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/submit/', headers)
        with _as_role(OWNER) as headers:
            approve_resp = _post_json(
                self.client, f'/adminapi/dictionary/revisions/{revision_id}/approve/', headers,
            )
        self.assertEqual(approve_resp.status_code, 200)

        db = connect_module.SessionLocal()
        try:
            self.assertIsNone(db.query(m.Word).filter(m.Word.id == self.word_id).first())
            item = db.query(m.WordExplanationAnaphoraItem).filter(
                m.WordExplanationAnaphoraItem.name == "target"
            ).one()
            self.assertIsNone(item.word_id)  # 連結被清空而不是連帶砍掉那筆標註
        finally:
            db.close()


class WordListTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        self.client = Client()
        self.seed_tribe()
        for i in range(3):
            self.seed_word(word_id=f"word-{i}", name=f"name-{i}")

    def test_list_paginates_and_filters_by_tribe(self):
        with _as_role(EDITOR) as headers:
            resp = self.client.get(
                '/adminapi/dictionary/words/?tribe_id=tribe-tayal&page_size=2', **headers,
            )
        body = resp.json()
        self.assertEqual(body["count"], 3)
        self.assertEqual(len(body["results"]), 2)

    def test_list_keyword_prefix_match(self):
        with _as_role(EDITOR) as headers:
            resp = self.client.get('/adminapi/dictionary/words/?keyword=name-1', **headers)
        body = resp.json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["id"], "word-1")

    def test_list_annotates_pending_revision(self):
        DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_WORD, target_id="word-0",
            operation=DictionaryRevision.OPERATION_UPDATE, payload={},
            status=DictionaryRevision.STATUS_PENDING_REVIEW,
            created_by="editor-uid", submitted_by="editor-uid",
        )
        with _as_role(EDITOR) as headers:
            resp = self.client.get('/adminapi/dictionary/words/', **headers)
        results_by_id = {r["id"]: r for r in resp.json()["results"]}
        self.assertIsNotNone(results_by_id["word-0"]["pending_revision"])
        self.assertIsNone(results_by_id["word-1"]["pending_revision"])

    def test_has_pending_filter_scopes_to_words_with_pending_revision(self):
        DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_WORD, target_id="word-0",
            operation=DictionaryRevision.OPERATION_UPDATE, payload={},
            status=DictionaryRevision.STATUS_PENDING_REVIEW,
            created_by="editor-uid", submitted_by="editor-uid",
        )
        # word-1 有一筆草稿但還沒送審——has_pending 篩選只看 pending_review，
        # 草稿是私人工作副本，不該讓其他人在列表篩選裡看到。
        DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_WORD, target_id="word-1",
            operation=DictionaryRevision.OPERATION_UPDATE, payload={},
            status=DictionaryRevision.STATUS_DRAFT,
            created_by="editor-uid", submitted_by="",
        )
        with _as_role(EDITOR) as headers:
            resp = self.client.get('/adminapi/dictionary/words/?has_pending=true', **headers)
        body = resp.json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["id"], "word-0")

    def test_has_pending_filter_with_no_matches_returns_empty(self):
        with _as_role(EDITOR) as headers:
            resp = self.client.get('/adminapi/dictionary/words/?has_pending=true', **headers)
        body = resp.json()
        self.assertEqual(body["count"], 0)
        self.assertEqual(body["results"], [])
