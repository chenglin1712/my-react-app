"""P4.3 語法管理：文法章節聚合讀寫、送審流程（沿用 dictionary_views.py 的
DictionaryRevision 端點）、詞綴/詞彙跨族語連結拒絕、章節排序直接寫入。

跟 test_dictionary_words.py 同樣的理由繼承 DictionaryDbTestCase——這裡要測
的正是「SQL 本身對不對」（rule_order/example_order 從陣列位置推導、
grammar_rule_affix/grammar_example_word 對帳正確、cascade 刪除整棵子樹），
不能用 MagicMock 頂替。
"""
import json
from contextlib import contextmanager
from unittest.mock import patch

from django.test import Client
from django.test.utils import override_settings

from config.roles import ANALYST, EDITOR, REVIEWER
from dictionary_db import connect as connect_module
from dictionary_db import model as m

from .dictionary_test_base import DictionaryDbTestCase
from .models import AuditLog, DictionaryRevision


@contextmanager
def _as_role(role):
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": "test-uid"}
            if role is not None:
                decoded["role"] = role
            with patch("firebase_admin.auth.verify_id_token", return_value=decoded):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _post_json(client, url, headers, payload=None):
    return client.post(url, data=json.dumps(payload or {}), content_type="application/json", **headers)


def _put_json(client, url, headers, payload=None):
    return client.put(url, data=json.dumps(payload or {}), content_type="application/json", **headers)


_MINIMAL_SECTION_PAYLOAD = {
    "tribe_id": "tribe-tayal",
    "title": "時態與時貌系統",
    "section_key": "tense",
    "description": "",
    "rules": [
        {
            "title": "進行式",
            "structure": "m- + 動詞",
            "function": "表示動作正在進行",
            "notes": "",
            "affix_ids": [],
            "examples": [
                {"tribe_text": "malax", "chinese_text": "在做", "analysis": "", "linked_words": []},
            ],
        },
    ],
}


class GrammarSectionCreateFlowTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        self.client = Client()
        self.seed_tribe()

    def test_analyst_cannot_create(self):
        with _as_role(ANALYST) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/grammar/sections/', headers, _MINIMAL_SECTION_PAYLOAD)
        self.assertEqual(resp.status_code, 403)

    def test_no_role_cannot_list(self):
        with _as_role(None) as headers:
            resp = self.client.get('/adminapi/dictionary/grammar/sections/?tribe_id=tribe-tayal', **headers)
        self.assertEqual(resp.status_code, 403)

    def test_list_requires_tribe_id(self):
        with _as_role(EDITOR) as headers:
            resp = self.client.get('/adminapi/dictionary/grammar/sections/', **headers)
        self.assertEqual(resp.status_code, 400)

    def test_editor_creates_draft_proposal_not_written_to_dictionary_db(self):
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/grammar/sections/', headers, _MINIMAL_SECTION_PAYLOAD)
        self.assertEqual(resp.status_code, 201)
        revision_id = resp.json()["revision_id"]

        revision = DictionaryRevision.objects.get(pk=revision_id)
        self.assertEqual(revision.status, DictionaryRevision.STATUS_DRAFT)
        self.assertEqual(revision.operation, DictionaryRevision.OPERATION_CREATE)
        self.assertEqual(revision.target_id, "")
        self.assertEqual(revision.target_kind, DictionaryRevision.TARGET_GRAMMAR_SECTION)

        db = connect_module.SessionLocal()
        try:
            self.assertEqual(db.query(m.GrammarSection).count(), 0)
        finally:
            db.close()

        self.assertTrue(
            AuditLog.objects.filter(
                action="propose_create", target_type="dictionary_grammar_section_revision",
            ).exists()
        )

    def test_missing_required_field_rejected(self):
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/grammar/sections/', headers, {"tribe_id": "tribe-tayal"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("title", resp.json()["errors"])

    def test_non_integer_affix_id_rejected(self):
        """跟 test_dictionary_words.py 的同名測試同一種缺口：affix_ids 元素
        型別不對（例如字串）原本只檢查「是不是陣列」就放行，_require_int_id_list()
        要在請求驗證這一層就攔下來，不是撐到 dictionary_write.py 對整數欄位
        下 IN 查詢時才被資料庫拒絕。"""
        payload = {
            **_MINIMAL_SECTION_PAYLOAD,
            "rules": [{**_MINIMAL_SECTION_PAYLOAD["rules"][0], "affix_ids": ["not-an-id"]}],
        }
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/grammar/sections/', headers, payload)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("rules[0].affix_ids[0]", resp.json()["errors"])

    def test_full_lifecycle_submit_approve_writes_to_dictionary_db(self):
        with _as_role(EDITOR) as headers:
            create_resp = _post_json(self.client, '/adminapi/dictionary/grammar/sections/', headers, _MINIMAL_SECTION_PAYLOAD)
        revision_id = create_resp.json()["revision_id"]

        with _as_role(EDITOR) as headers:
            submit_resp = _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/submit/', headers)
        self.assertEqual(submit_resp.json()["status"], "pending_review")

        with _as_role(EDITOR) as headers:
            forbidden_resp = _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/approve/', headers)
        self.assertEqual(forbidden_resp.status_code, 403)

        with _as_role(REVIEWER) as headers:
            approve_resp = _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/approve/', headers)
        self.assertEqual(approve_resp.status_code, 200)
        new_section_id = approve_resp.json()["target_id"]
        self.assertTrue(new_section_id)

        db = connect_module.SessionLocal()
        try:
            section = db.query(m.GrammarSection).filter(m.GrammarSection.id == int(new_section_id)).one()
            self.assertEqual(section.title, "時態與時貌系統")
            self.assertEqual(section.section_order, 1)  # 該族語目前唯一一個章節，排在最後＝第一個
            rules = db.query(m.GrammarRule).filter(m.GrammarRule.section_id == section.id).all()
            self.assertEqual(len(rules), 1)
            self.assertEqual(rules[0].rule_order, 0)
            examples = db.query(m.GrammarExample).filter(m.GrammarExample.rule_id == rules[0].id).all()
            self.assertEqual(len(examples), 1)
            self.assertEqual(examples[0].tribe_text, "malax")
        finally:
            db.close()

        revision = DictionaryRevision.objects.get(pk=revision_id)
        self.assertEqual(revision.status, DictionaryRevision.STATUS_APPROVED)
        self.assertEqual(revision.target_id, new_section_id)
        self.assertTrue(
            AuditLog.objects.filter(
                action="approve_proposal", target_id=new_section_id,
                target_type="dictionary_grammar_section_revision",
            ).exists()
        )

    def test_second_section_lands_after_first_in_section_order(self):
        with _as_role(EDITOR) as headers:
            first = _post_json(self.client, '/adminapi/dictionary/grammar/sections/', headers, _MINIMAL_SECTION_PAYLOAD)
            _post_json(self.client, f'/adminapi/dictionary/revisions/{first.json()["revision_id"]}/submit/', headers)
        with _as_role(REVIEWER) as headers:
            _post_json(self.client, f'/adminapi/dictionary/revisions/{first.json()["revision_id"]}/approve/', headers)

        second_payload = {**_MINIMAL_SECTION_PAYLOAD, "title": "焦點系統", "section_key": "focus"}
        with _as_role(EDITOR) as headers:
            second = _post_json(self.client, '/adminapi/dictionary/grammar/sections/', headers, second_payload)
            _post_json(self.client, f'/adminapi/dictionary/revisions/{second.json()["revision_id"]}/submit/', headers)
        with _as_role(REVIEWER) as headers:
            approve_resp = _post_json(
                self.client, f'/adminapi/dictionary/revisions/{second.json()["revision_id"]}/approve/', headers,
            )
        second_id = approve_resp.json()["target_id"]

        db = connect_module.SessionLocal()
        try:
            section = db.query(m.GrammarSection).filter(m.GrammarSection.id == int(second_id)).one()
            self.assertEqual(section.section_order, 2)
        finally:
            db.close()

    def test_cross_tribe_affix_link_rejected(self):
        other_tribe = self.seed_tribe(tribe_id="tribe-amis", name="阿美語", slug="amis")
        db = connect_module.SessionLocal()
        try:
            affix = m.GrammarAffix(tribe_id=other_tribe, affix="ma-", affix_type="prefix")
            db.add(affix)
            db.commit()
            affix_id = affix.id
        finally:
            db.close()

        payload = {
            **_MINIMAL_SECTION_PAYLOAD,
            "rules": [{**_MINIMAL_SECTION_PAYLOAD["rules"][0], "affix_ids": [affix_id]}],
        }
        with _as_role(EDITOR) as headers:
            create_resp = _post_json(self.client, '/adminapi/dictionary/grammar/sections/', headers, payload)
            revision_id = create_resp.json()["revision_id"]
            _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/submit/', headers)
        with _as_role(REVIEWER) as headers:
            approve_resp = _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/approve/', headers)
        self.assertEqual(approve_resp.status_code, 400)

        db = connect_module.SessionLocal()
        try:
            self.assertEqual(db.query(m.GrammarSection).count(), 0)
        finally:
            db.close()

    def test_cross_tribe_linked_word_rejected(self):
        other_tribe = self.seed_tribe(tribe_id="tribe-amis", name="阿美語", slug="amis")
        other_word = self.seed_word(word_id="word-amis-1", tribe_id=other_tribe, name="kolong")

        payload = {
            **_MINIMAL_SECTION_PAYLOAD,
            "rules": [{
                **_MINIMAL_SECTION_PAYLOAD["rules"][0],
                "examples": [{
                    "tribe_text": "malax", "chinese_text": "在做", "analysis": "",
                    "linked_words": [{"word_id": other_word}],
                }],
            }],
        }
        with _as_role(EDITOR) as headers:
            create_resp = _post_json(self.client, '/adminapi/dictionary/grammar/sections/', headers, payload)
            revision_id = create_resp.json()["revision_id"]
            _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/submit/', headers)
        with _as_role(REVIEWER) as headers:
            approve_resp = _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/approve/', headers)
        self.assertEqual(approve_resp.status_code, 400)


class GrammarSectionUpdateFlowTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        self.client = Client()
        self.seed_tribe()
        self.section_id = self._approve_minimal_section()

    def _approve_minimal_section(self):
        with _as_role(EDITOR) as headers:
            create_resp = _post_json(self.client, '/adminapi/dictionary/grammar/sections/', headers, _MINIMAL_SECTION_PAYLOAD)
            revision_id = create_resp.json()["revision_id"]
            _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/submit/', headers)
        with _as_role(REVIEWER) as headers:
            approve_resp = _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/approve/', headers)
        return approve_resp.json()["target_id"]

    def test_detail_returns_full_tree_with_content_hash(self):
        with _as_role(EDITOR) as headers:
            resp = self.client.get(f'/adminapi/dictionary/grammar/sections/{self.section_id}/', **headers)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["title"], "時態與時貌系統")
        self.assertEqual(len(body["rules"]), 1)
        self.assertIn("content_hash", body)
        self.assertIsNone(body["meta"]["pending_revision"])

    def test_list_shows_rule_count_and_section_order(self):
        with _as_role(EDITOR) as headers:
            resp = self.client.get('/adminapi/dictionary/grammar/sections/?tribe_id=tribe-tayal', **headers)
        self.assertEqual(resp.status_code, 200)
        results = resp.json()["results"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["rule_count"], 1)
        self.assertEqual(results[0]["section_order"], 1)

    def test_propose_update_reconciles_rules_by_id(self):
        db = connect_module.SessionLocal()
        try:
            existing_rule = db.query(m.GrammarRule).filter(
                m.GrammarRule.section_id == int(self.section_id)
            ).one()
            existing_rule_id = existing_rule.id
        finally:
            db.close()

        updated_payload = {
            **_MINIMAL_SECTION_PAYLOAD,
            "rules": [
                {"id": existing_rule_id, "title": "進行式（修訂）", "affix_ids": [], "examples": []},
                {"title": "完成式", "affix_ids": [], "examples": []},
            ],
        }
        with _as_role(EDITOR) as headers:
            propose_resp = _post_json(
                self.client, f'/adminapi/dictionary/grammar/sections/{self.section_id}/propose/', headers,
                updated_payload,
            )
        revision_id = propose_resp.json()["revision_id"]
        with _as_role(EDITOR) as headers:
            _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/submit/', headers)
        with _as_role(REVIEWER) as headers:
            approve_resp = _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/approve/', headers)
        self.assertEqual(approve_resp.status_code, 200)

        db = connect_module.SessionLocal()
        try:
            rules = (
                db.query(m.GrammarRule).filter(m.GrammarRule.section_id == int(self.section_id))
                .order_by(m.GrammarRule.rule_order).all()
            )
            self.assertEqual(len(rules), 2)
            self.assertEqual(rules[0].id, existing_rule_id)  # 保留原本的 id，不是刪除重建
            self.assertEqual(rules[0].title, "進行式（修訂）")
            self.assertEqual(rules[1].title, "完成式")
        finally:
            db.close()

    def test_base_hash_conflict_on_approve(self):
        with _as_role(EDITOR) as headers:
            propose_resp = _post_json(
                self.client, f'/adminapi/dictionary/grammar/sections/{self.section_id}/propose/', headers,
                {**_MINIMAL_SECTION_PAYLOAD, "title": "第一次修改", "base_hash": "sha256:stale-hash"},
            )
        revision_id = propose_resp.json()["revision_id"]
        with _as_role(EDITOR) as headers:
            _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/submit/', headers)
        with _as_role(REVIEWER) as headers:
            approve_resp = _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/approve/', headers)
        self.assertEqual(approve_resp.status_code, 409)

    def test_delete_proposal_and_approve_removes_whole_subtree(self):
        with _as_role(EDITOR) as headers:
            delete_resp = _post_json(
                self.client, f'/adminapi/dictionary/grammar/sections/{self.section_id}/delete-proposal/', headers,
            )
        revision_id = delete_resp.json()["revision_id"]
        with _as_role(EDITOR) as headers:
            _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/submit/', headers)
        with _as_role(REVIEWER) as headers:
            approve_resp = _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/approve/', headers)
        self.assertEqual(approve_resp.status_code, 200)

        db = connect_module.SessionLocal()
        try:
            self.assertIsNone(
                db.query(m.GrammarSection).filter(m.GrammarSection.id == int(self.section_id)).first()
            )
            self.assertEqual(db.query(m.GrammarRule).count(), 0)
            self.assertEqual(db.query(m.GrammarExample).count(), 0)
        finally:
            db.close()

    def test_second_pending_proposal_rejected(self):
        with _as_role(EDITOR) as headers:
            _post_json(
                self.client, f'/adminapi/dictionary/grammar/sections/{self.section_id}/propose/', headers,
                {**_MINIMAL_SECTION_PAYLOAD, "title": "改一次"},
            )
            resp = _post_json(
                self.client, f'/adminapi/dictionary/grammar/sections/{self.section_id}/delete-proposal/', headers,
            )
        self.assertEqual(resp.status_code, 409)


class GrammarSectionReorderTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        self.client = Client()
        self.seed_tribe()
        self.section_ids = self._create_three_sections()

    def _create_three_sections(self):
        ids = []
        for i, title in enumerate(["章節A", "章節B", "章節C"]):
            with _as_role(EDITOR) as headers:
                create_resp = _post_json(
                    self.client, '/adminapi/dictionary/grammar/sections/', headers,
                    {**_MINIMAL_SECTION_PAYLOAD, "title": title, "section_key": f"key-{i}", "rules": []},
                )
                revision_id = create_resp.json()["revision_id"]
                _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/submit/', headers)
            with _as_role(REVIEWER) as headers:
                approve_resp = _post_json(self.client, f'/adminapi/dictionary/revisions/{revision_id}/approve/', headers)
            ids.append(int(approve_resp.json()["target_id"]))
        return ids

    def test_reorder_is_direct_write_not_a_revision(self):
        # setUp 已經走過 3 次完整的 create→submit→approve（每個章節各自留下
        # 一筆 status=approved 的 DictionaryRevision）——這裡要驗證的是
        # 「排序本身」不會再多留一筆，不是「完全沒有任何 revision」。
        revision_count_before = DictionaryRevision.objects.filter(
            target_kind=DictionaryRevision.TARGET_GRAMMAR_SECTION,
        ).count()

        reversed_ids = list(reversed(self.section_ids))
        with _as_role(EDITOR) as headers:
            resp = _post_json(
                self.client, '/adminapi/dictionary/grammar/sections/reorder/', headers,
                {"tribe_id": "tribe-tayal", "section_ids": reversed_ids},
            )
        self.assertEqual(resp.status_code, 200)

        db = connect_module.SessionLocal()
        try:
            sections = {
                s.id: s.section_order for s in
                db.query(m.GrammarSection).filter(m.GrammarSection.tribe_id == "tribe-tayal").all()
            }
        finally:
            db.close()
        for index, sid in enumerate(reversed_ids):
            self.assertEqual(sections[sid], index)

        # 排序不是送審動作，不會產生新的 DictionaryRevision。
        self.assertEqual(
            DictionaryRevision.objects.filter(target_kind=DictionaryRevision.TARGET_GRAMMAR_SECTION).count(),
            revision_count_before,
        )

    def test_reorder_rejects_incomplete_id_set(self):
        with _as_role(EDITOR) as headers:
            resp = _post_json(
                self.client, '/adminapi/dictionary/grammar/sections/reorder/', headers,
                {"tribe_id": "tribe-tayal", "section_ids": self.section_ids[:2]},
            )
        self.assertEqual(resp.status_code, 400)

    def test_reorder_rejects_duplicate_ids_even_if_set_matches(self):
        """一份帶重複 id 的清單，如果重複的部分湊巧讓 set() 去重後跟既有
        章節集合相同，只檢查集合相等會誤判成合法——必須連長度一起檢查，
        否則重複 id 會用陣列裡最後一次出現的位置覆蓋掉正確的排序結果，
        且完全不會回報任何錯誤（這是實際端到端驗證時發現的真實案例）。"""
        # set(duplicated) 仍然等於全部 3 個既有章節 id（每個 id 至少出現一次），
        # 只是其中一個重複、長度變成 4——如果只檢查集合相等會誤判成合法。
        duplicated = [
            self.section_ids[0], self.section_ids[1], self.section_ids[2], self.section_ids[1],
        ]
        with _as_role(EDITOR) as headers:
            resp = _post_json(
                self.client, '/adminapi/dictionary/grammar/sections/reorder/', headers,
                {"tribe_id": "tribe-tayal", "section_ids": duplicated},
            )
        self.assertEqual(resp.status_code, 400)

    def test_reviewer_cannot_reorder(self):
        with _as_role(REVIEWER) as headers:
            resp = _post_json(
                self.client, '/adminapi/dictionary/grammar/sections/reorder/', headers,
                {"tribe_id": "tribe-tayal", "section_ids": self.section_ids},
            )
        self.assertEqual(resp.status_code, 403)
