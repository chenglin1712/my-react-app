"""P4.2 主檔管理：source／category／part_of_speech／focus／grammar_affix 的
CRUD＋合併。跟 test_dictionary_words.py 同樣的理由繼承 DictionaryDbTestCase
（見該檔案說明）——這裡要測的正是「SQL 本身對不對」：合併不製造重複配對、
grammar_rule_affix 複合主鍵不會被違反、刪除前確實先查引用數而不是依賴
資料庫的 FK 行為，MagicMock 證明不了這些。
"""
import json
from contextlib import contextmanager
from unittest.mock import patch

from django.test import Client
from django.test.utils import override_settings

from config.roles import ANALYST, EDITOR, OWNER
from config.tribes import TRIBES
from dictionary_db import connect as connect_module
from dictionary_db import model as m

_TAYAL = TRIBES[0]  # 真實的 tribe_id（config/tribes.py 的 UUID），跟快取失效
                     # 呼叫端解析 slug 用的是同一份對照表，見 GrammarAffixCrudTest
                     # 底下驗證失效呼叫帶對 tribes=["tayal"] 的測試——其餘測試用
                     # dictionary_test_base.seed_tribe() 預設的假 id 沒問題，
                     # 那些測試不驗證 slug 解析結果。

from .dictionary_test_base import DictionaryDbTestCase
from .models import AuditLog


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


def _patch_json(client, url, headers, payload=None):
    return client.patch(url, data=json.dumps(payload or {}), content_type="application/json", **headers)


class TaxonomyTermCrudTest(DictionaryDbTestCase):
    """source／category／part_of_speech／focus 共用同一套邏輯，只需要對其中
    一種（category）測完整流程，其餘三種只驗證路由確實接對（kind 參數
    正確分派到對應的 model）。"""

    def setUp(self):
        super().setUp()
        self.client = Client()

    def test_analyst_cannot_create(self):
        with _as_role(ANALYST) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/taxonomies/category/', headers, {"name": "動物"})
        self.assertEqual(resp.status_code, 403)

    def test_unknown_kind_404(self):
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/taxonomies/tribe/', headers, {"name": "x"})
        self.assertEqual(resp.status_code, 404)

    def test_editor_creates_category(self):
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/taxonomies/category/', headers, {"name": "動物"})
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertEqual(body["name"], "動物")
        self.assertEqual(body["reference_count"], 0)
        self.assertTrue(AuditLog.objects.filter(action="create_taxonomy_term", target_id=f"category:{body['id']}").exists())

    def test_duplicate_name_rejected(self):
        with _as_role(EDITOR) as headers:
            _post_json(self.client, '/adminapi/dictionary/taxonomies/category/', headers, {"name": "動物"})
            resp = _post_json(self.client, '/adminapi/dictionary/taxonomies/category/', headers, {"name": "動物"})
        self.assertEqual(resp.status_code, 400)

    def test_blank_name_rejected(self):
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/taxonomies/category/', headers, {"name": "  "})
        self.assertEqual(resp.status_code, 400)

    def test_rename_category(self):
        with _as_role(EDITOR) as headers:
            create_resp = _post_json(self.client, '/adminapi/dictionary/taxonomies/category/', headers, {"name": "動物"})
        pk = create_resp.json()["id"]
        with _as_role(EDITOR) as headers:
            resp = _patch_json(self.client, f'/adminapi/dictionary/taxonomies/category/{pk}/', headers, {"name": "動物類"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["name"], "動物類")

    def test_update_nonexistent_404(self):
        with _as_role(EDITOR) as headers:
            resp = _patch_json(self.client, '/adminapi/dictionary/taxonomies/category/999999/', headers, {"name": "x"})
        self.assertEqual(resp.status_code, 404)

    def test_delete_unreferenced_category(self):
        with _as_role(EDITOR) as headers:
            create_resp = _post_json(self.client, '/adminapi/dictionary/taxonomies/category/', headers, {"name": "動物"})
        pk = create_resp.json()["id"]
        with _as_role(EDITOR) as headers:
            resp = self.client.delete(f'/adminapi/dictionary/taxonomies/category/{pk}/', **headers)
        self.assertEqual(resp.status_code, 200)

        db = connect_module.SessionLocal()
        try:
            self.assertIsNone(db.query(m.Category).filter(m.Category.id == pk).first())
        finally:
            db.close()

    def test_delete_referenced_category_blocked_with_count(self):
        pk, _word_id = self._seed_referenced_category()
        with _as_role(EDITOR) as headers:
            resp = self.client.delete(f'/adminapi/dictionary/taxonomies/category/{pk}/', **headers)
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["references"]["references"], 1)

        db = connect_module.SessionLocal()
        try:
            self.assertIsNotNone(db.query(m.Category).filter(m.Category.id == pk).first())
        finally:
            db.close()

    def _seed_referenced_category(self, name="動物"):
        db = connect_module.SessionLocal()
        try:
            db.add(m.Tribe(id="tribe-tayal", name="泰雅語", slug="tayal"))
            word = m.Word(id="word-1", tribe_id="tribe-tayal", name="huzil")
            db.add(word)
            db.flush()
            explanation = m.WordExplanation(word_id=word.id, chinese_explanation="狗")
            db.add(explanation)
            db.flush()
            category = m.Category(name=name)
            db.add(category)
            db.flush()
            db.add(m.WordExplanationCategory(explanation_id=explanation.id, category_id=category.id))
            db.commit()
            return category.id, word.id
        finally:
            db.close()

    def test_taxonomy_list_includes_reference_count(self):
        pk, _word_id = self._seed_referenced_category()
        with _as_role(EDITOR) as headers:
            resp = self.client.get('/adminapi/dictionary/taxonomies/', **headers)
        self.assertEqual(resp.status_code, 200)
        rows = {row["id"]: row for row in resp.json()["category"]}
        self.assertEqual(rows[pk]["reference_count"], 1)

    @patch("adminapi.dictionary_taxonomy_views.invalidate_dictionary_cache")
    def test_rename_referenced_category_invalidates_words_cache(self, mock_invalidate):
        pk, _word_id = self._seed_referenced_category()
        with _as_role(EDITOR) as headers:
            resp = _patch_json(self.client, f'/adminapi/dictionary/taxonomies/category/{pk}/', headers, {"name": "動物類"})
        self.assertEqual(resp.status_code, 200)
        mock_invalidate.assert_called_once_with(["words"], tribes=None)

    @patch("adminapi.dictionary_taxonomy_views.invalidate_dictionary_cache")
    def test_rename_unreferenced_category_does_not_invalidate_cache(self, mock_invalidate):
        with _as_role(EDITOR) as headers:
            create_resp = _post_json(self.client, '/adminapi/dictionary/taxonomies/category/', headers, {"name": "動物"})
        pk = create_resp.json()["id"]
        with _as_role(EDITOR) as headers:
            _patch_json(self.client, f'/adminapi/dictionary/taxonomies/category/{pk}/', headers, {"name": "動物類"})
        mock_invalidate.assert_not_called()

    def test_source_part_of_speech_focus_routes_dispatch_correctly(self):
        """其餘三種 kind 只驗證路由分派到正確的 model，不重複整套流程。"""
        for kind, model in (
            ("source", m.Source), ("part_of_speech", m.PartOfSpeech), ("focus", m.Focus),
        ):
            with _as_role(EDITOR) as headers:
                resp = _post_json(self.client, f'/adminapi/dictionary/taxonomies/{kind}/', headers, {"name": f"test-{kind}"})
            self.assertEqual(resp.status_code, 201, kind)
            pk = resp.json()["id"]
            db = connect_module.SessionLocal()
            try:
                self.assertIsNotNone(db.query(model).filter(model.id == pk).first(), kind)
            finally:
                db.close()


class TaxonomyMergeTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        self.client = Client()

    def test_editor_cannot_merge(self):
        with _as_role(EDITOR) as headers:
            source_id, target_id = self._seed_two_categories()
            resp = _post_json(
                self.client, f'/adminapi/dictionary/taxonomies/category/{source_id}/merge/', headers,
                {"target_id": target_id},
            )
        self.assertEqual(resp.status_code, 403)

    def test_self_merge_rejected(self):
        with _as_role(OWNER) as headers:
            source_id, _target_id = self._seed_two_categories()
            resp = _post_json(
                self.client, f'/adminapi/dictionary/taxonomies/category/{source_id}/merge/', headers,
                {"target_id": source_id},
            )
        self.assertEqual(resp.status_code, 400)

    def test_merge_nonexistent_target_404(self):
        with _as_role(OWNER) as headers:
            source_id, _target_id = self._seed_two_categories()
            resp = _post_json(
                self.client, f'/adminapi/dictionary/taxonomies/category/{source_id}/merge/', headers,
                {"target_id": 999999},
            )
        self.assertEqual(resp.status_code, 404)

    def _seed_two_categories(self, name_a="動物", name_b="動物類"):
        db = connect_module.SessionLocal()
        try:
            a = m.Category(name=name_a)
            b = m.Category(name=name_b)
            db.add_all([a, b])
            db.commit()
            return a.id, b.id
        finally:
            db.close()

    def _seed_word_with_explanation(self, db, word_id, tribe_id="tribe-tayal"):
        word = m.Word(id=word_id, tribe_id=tribe_id, name=word_id)
        db.add(word)
        db.flush()
        explanation = m.WordExplanation(word_id=word.id, chinese_explanation="測試")
        db.add(explanation)
        db.flush()
        return explanation

    @patch("adminapi.dictionary_taxonomy_views.invalidate_dictionary_cache")
    def test_merge_reassigns_references_and_deletes_source(self, mock_invalidate):
        db = connect_module.SessionLocal()
        try:
            db.add(m.Tribe(id="tribe-tayal", name="泰雅語", slug="tayal"))
            explanation = self._seed_word_with_explanation(db, "word-1")
            source = m.Category(name="動物")
            target = m.Category(name="動物類")
            db.add_all([source, target])
            db.flush()
            db.add(m.WordExplanationCategory(explanation_id=explanation.id, category_id=source.id))
            db.commit()
            source_id, target_id, explanation_id = source.id, target.id, explanation.id
        finally:
            db.close()

        with _as_role(OWNER) as headers:
            resp = _post_json(
                self.client, f'/adminapi/dictionary/taxonomies/category/{source_id}/merge/', headers,
                {"target_id": target_id},
            )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["merged_references"], 1)
        mock_invalidate.assert_called_once_with(["words"], tribes=None)

        db = connect_module.SessionLocal()
        try:
            self.assertIsNone(db.query(m.Category).filter(m.Category.id == source_id).first())
            self.assertIsNotNone(db.query(m.Category).filter(m.Category.id == target_id).first())
            links = (
                db.query(m.WordExplanationCategory)
                .filter(m.WordExplanationCategory.explanation_id == explanation_id).all()
            )
            self.assertEqual([link.category_id for link in links], [target_id])
        finally:
            db.close()

    def test_merge_does_not_create_duplicate_when_target_already_linked(self):
        """解釋同時掛了合併前後兩個分類——合併後不能出現「動物、動物類」
        兩筆重複配對，只能留一筆指向目標。"""
        db = connect_module.SessionLocal()
        try:
            db.add(m.Tribe(id="tribe-tayal", name="泰雅語", slug="tayal"))
            explanation = self._seed_word_with_explanation(db, "word-1")
            source = m.Category(name="動物")
            target = m.Category(name="動物類")
            db.add_all([source, target])
            db.flush()
            db.add(m.WordExplanationCategory(explanation_id=explanation.id, category_id=source.id))
            db.add(m.WordExplanationCategory(explanation_id=explanation.id, category_id=target.id))
            db.commit()
            source_id, target_id, explanation_id = source.id, target.id, explanation.id
        finally:
            db.close()

        with _as_role(OWNER) as headers:
            resp = _post_json(
                self.client, f'/adminapi/dictionary/taxonomies/category/{source_id}/merge/', headers,
                {"target_id": target_id},
            )
        self.assertEqual(resp.status_code, 200)

        db = connect_module.SessionLocal()
        try:
            links = (
                db.query(m.WordExplanationCategory)
                .filter(m.WordExplanationCategory.explanation_id == explanation_id).all()
            )
            # 沒有因為合併而變成重複的兩筆「動物類」，只留下原本已存在的那一筆。
            self.assertEqual([link.category_id for link in links], [target_id])
        finally:
            db.close()


class GrammarAffixCrudTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        self.client = Client()
        db = connect_module.SessionLocal()
        try:
            db.add(m.Tribe(id=_TAYAL.id, name="泰雅語", slug="tayal"))
            db.add(m.Tribe(id="tribe-amis", name="阿美語", slug="amis"))
            db.commit()
        finally:
            db.close()

    def test_create_affix(self):
        with _as_role(EDITOR) as headers:
            resp = _post_json(
                self.client, '/adminapi/dictionary/taxonomies/grammar_affix/', headers,
                {"tribe_id": _TAYAL.id, "affix": "m-", "affix_type": "prefix", "function": "主事焦點"},
            )
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertEqual(body["affix"], "m-")
        self.assertEqual(body["affix_type"], "prefix")
        self.assertEqual(body["function"], "主事焦點")

    def test_create_affix_invalid_type_rejected(self):
        with _as_role(EDITOR) as headers:
            resp = _post_json(
                self.client, '/adminapi/dictionary/taxonomies/grammar_affix/', headers,
                {"tribe_id": _TAYAL.id, "affix": "m-", "affix_type": "not-a-real-type"},
            )
        self.assertEqual(resp.status_code, 400)

    def test_create_affix_unknown_tribe_rejected(self):
        with _as_role(EDITOR) as headers:
            resp = _post_json(
                self.client, '/adminapi/dictionary/taxonomies/grammar_affix/', headers,
                {"tribe_id": "no-such-tribe", "affix": "m-", "affix_type": "prefix"},
            )
        self.assertEqual(resp.status_code, 400)

    def test_update_affix_partial(self):
        with _as_role(EDITOR) as headers:
            create_resp = _post_json(
                self.client, '/adminapi/dictionary/taxonomies/grammar_affix/', headers,
                {"tribe_id": _TAYAL.id, "affix": "m-", "affix_type": "prefix"},
            )
        pk = create_resp.json()["id"]
        with _as_role(EDITOR) as headers:
            resp = _patch_json(
                self.client, f'/adminapi/dictionary/taxonomies/grammar_affix/{pk}/', headers,
                {"function": "新的說明"},
            )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["function"], "新的說明")
        self.assertEqual(body["affix"], "m-")  # 沒帶到的欄位維持原值

    def test_update_affix_empty_body_rejected(self):
        with _as_role(EDITOR) as headers:
            create_resp = _post_json(
                self.client, '/adminapi/dictionary/taxonomies/grammar_affix/', headers,
                {"tribe_id": _TAYAL.id, "affix": "m-", "affix_type": "prefix"},
            )
        pk = create_resp.json()["id"]
        with _as_role(EDITOR) as headers:
            resp = _patch_json(self.client, f'/adminapi/dictionary/taxonomies/grammar_affix/{pk}/', headers, {})
        self.assertEqual(resp.status_code, 400)

    def _seed_rule_with_affix(self, db, tribe_id, affix_id=None, affix_kwargs=None):
        section = m.GrammarSection(tribe_id=tribe_id, section_order=1, title="s")
        db.add(section)
        db.flush()
        rule = m.GrammarRule(section_id=section.id, rule_order=1, title="r")
        db.add(rule)
        db.flush()
        if affix_id is None:
            affix = m.GrammarAffix(tribe_id=tribe_id, **(affix_kwargs or {"affix": "m-", "affix_type": "prefix"}))
            db.add(affix)
            db.flush()
            affix_id = affix.id
        db.add(m.GrammarRuleAffix(rule_id=rule.id, affix_id=affix_id))
        db.flush()
        return rule.id, affix_id

    def test_delete_referenced_affix_blocked(self):
        db = connect_module.SessionLocal()
        try:
            _rule_id, affix_id = self._seed_rule_with_affix(db, _TAYAL.id)
            db.commit()
        finally:
            db.close()

        with _as_role(EDITOR) as headers:
            resp = self.client.delete(f'/adminapi/dictionary/taxonomies/grammar_affix/{affix_id}/', **headers)
        self.assertEqual(resp.status_code, 409)

    def test_merge_cross_tribe_affix_rejected(self):
        db = connect_module.SessionLocal()
        try:
            tayal_affix = m.GrammarAffix(tribe_id=_TAYAL.id, affix="m-", affix_type="prefix")
            amis_affix = m.GrammarAffix(tribe_id="tribe-amis", affix="ma-", affix_type="prefix")
            db.add_all([tayal_affix, amis_affix])
            db.commit()
            source_id, target_id = tayal_affix.id, amis_affix.id
        finally:
            db.close()

        with _as_role(OWNER) as headers:
            resp = _post_json(
                self.client, f'/adminapi/dictionary/taxonomies/grammar_affix/{source_id}/merge/', headers,
                {"target_id": target_id},
            )
        self.assertEqual(resp.status_code, 400)

    @patch("adminapi.dictionary_taxonomy_views.invalidate_dictionary_cache")
    def test_merge_affix_reassigns_rule_links_without_duplicate_pk(self, mock_invalidate):
        """grammar_rule_affix 是複合主鍵（rule_id, affix_id）——這個測試要
        確認同一條規則同時掛了合併前後兩個詞綴時，合併不會因為想插入
        (rule_id, target_id) 重複配對而違反主鍵約束，而是正確去重成一筆。"""
        db = connect_module.SessionLocal()
        try:
            source_affix = m.GrammarAffix(tribe_id=_TAYAL.id, affix="m-", affix_type="prefix")
            target_affix = m.GrammarAffix(tribe_id=_TAYAL.id, affix="mu-", affix_type="prefix")
            db.add_all([source_affix, target_affix])
            db.flush()
            # rule_a 只掛 source（應該改指向 target）；rule_b 同時掛了 source
            # 跟 target（應該去重，只留一筆）。
            rule_a_id, _ = self._seed_rule_with_affix(db, _TAYAL.id, affix_id=source_affix.id)
            section_b = m.GrammarSection(tribe_id=_TAYAL.id, section_order=2, title="s2")
            db.add(section_b)
            db.flush()
            rule_b = m.GrammarRule(section_id=section_b.id, rule_order=1, title="r2")
            db.add(rule_b)
            db.flush()
            db.add(m.GrammarRuleAffix(rule_id=rule_b.id, affix_id=source_affix.id))
            db.add(m.GrammarRuleAffix(rule_id=rule_b.id, affix_id=target_affix.id))
            db.commit()
            source_id, target_id, rule_b_id = source_affix.id, target_affix.id, rule_b.id
        finally:
            db.close()

        with _as_role(OWNER) as headers:
            resp = _post_json(
                self.client, f'/adminapi/dictionary/taxonomies/grammar_affix/{source_id}/merge/', headers,
                {"target_id": target_id},
            )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["merged_references"], 2)
        mock_invalidate.assert_called_once_with(["grammar", "grammar_affixes", "grammar_quiz"], tribes=["tayal"])

        db = connect_module.SessionLocal()
        try:
            self.assertIsNone(db.query(m.GrammarAffix).filter(m.GrammarAffix.id == source_id).first())
            rule_a_links = (
                db.query(m.GrammarRuleAffix).filter(m.GrammarRuleAffix.rule_id == rule_a_id).all()
            )
            self.assertEqual([link.affix_id for link in rule_a_links], [target_id])
            rule_b_links = (
                db.query(m.GrammarRuleAffix).filter(m.GrammarRuleAffix.rule_id == rule_b_id).all()
            )
            self.assertEqual([link.affix_id for link in rule_b_links], [target_id])
        finally:
            db.close()
