"""P4.4 批次匯入／匯出精靈：結構檢查、預檢報告的名稱解析與新建/更新判斷、
逐筆交易隔離（一筆失敗不影響其他筆）、`preflight_hash` 併發保護、owner-only
自動建立缺漏主檔、匯出。

跟 test_dictionary_words.py 同樣的理由繼承 DictionaryDbTestCase——這裡要測
的正是「SQL 本身對不對」（逐筆各自交易、對帳保留既有子節點 id），不能用
MagicMock 頂替。
"""
import json
from contextlib import contextmanager
from unittest.mock import patch

from django.core.cache import cache
from django.test import Client
from django.test.utils import override_settings

from config.roles import ANALYST, EDITOR, OWNER, REVIEWER
from config.tribes import TRIBES
from dictionary_db import connect as connect_module
from dictionary_db import model as m
from dictionary_db.connect import dictionary_write_session

from .dictionary_test_base import DictionaryDbTestCase
from .models import AuditLog, DictionaryImportJob

_TAYAL = TRIBES[0]
_AMIS = TRIBES[1]


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


def _minimal_bundle(words):
    return {"schema": "dictionary_word_bundle", "version": 1, "tribe": "tayal", "words": words}


class ImportUploadTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()  # 這份檔案的測試量會超過每分鐘上限，避免不同測試方法互相撞到限流。
        self.client = Client()
        self.seed_tribe(tribe_id=_TAYAL.id, name=_TAYAL.full_name, slug=_TAYAL.slug)

    def test_analyst_cannot_upload(self):
        bundle = _minimal_bundle([{"name": "huzil"}])
        with _as_role(ANALYST) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/import/', headers,
                               {"filename": "test.json", "bundle": bundle})
        self.assertEqual(resp.status_code, 403)

    def test_wrong_schema_rejected(self):
        bundle = {**_minimal_bundle([{"name": "huzil"}]), "schema": "something_else"}
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/import/', headers,
                               {"filename": "test.json", "bundle": bundle})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("schema", resp.json()["errors"])

    def test_unsupported_tribe_rejected(self):
        bundle = {**_minimal_bundle([{"name": "huzil"}]), "tribe": "not-a-real-tribe"}
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/import/', headers,
                               {"filename": "test.json", "bundle": bundle})
        self.assertEqual(resp.status_code, 400)

    def test_upload_creates_job_with_row_errors_but_does_not_block(self):
        bundle = _minimal_bundle([
            {"name": "huzil"},
            {"name": ""},  # 結構性錯誤：name 不能空白
        ])
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/import/', headers,
                               {"filename": "test.json", "bundle": bundle})
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertEqual(body["status"], "uploaded")
        self.assertEqual(body["word_count"], 2)
        self.assertIn("1", {str(k) for k in body["row_errors"]})

        job = DictionaryImportJob.objects.get(pk=body["id"])
        self.assertEqual(job.tribe, "tayal")
        self.assertTrue(AuditLog.objects.filter(action="upload_import_job", target_id=str(job.pk)).exists())


class ImportPreflightTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()  # 這份檔案的測試量會超過每分鐘上限，避免不同測試方法互相撞到限流。
        self.client = Client()
        self.tribe_id = self.seed_tribe(tribe_id=_TAYAL.id, name=_TAYAL.full_name, slug=_TAYAL.slug)

        db = connect_module.SessionLocal()
        try:
            db.add(m.Category(name="動物"))
            db.add(m.Word(id="existing-word-1", tribe_id=self.tribe_id, name="既有詞"))
            db.commit()
        finally:
            db.close()

    def _upload(self, words):
        bundle = _minimal_bundle(words)
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/import/', headers,
                               {"filename": "test.json", "bundle": bundle})
        return resp.json()["id"]

    def test_preflight_classifies_create_update_and_error(self):
        job_id = self._upload([
            {"name": "新詞", "explanations": [{"chinese_explanation": "測試", "category_names": ["動物"]}]},
            {"name": "既有詞"},
            {"explanations": [{"chinese_explanation": "缺分類", "category_names": ["不存在的分類"]}], "name": "壞詞"},
        ])
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/preflight/', headers)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["status"], "validated")
        self.assertEqual(body["new_count"], 1)
        self.assertEqual(body["update_count"], 1)
        self.assertEqual(body["error_count"], 1)

        items = body["report"]["items"]
        self.assertEqual(items[0]["action"], "create")
        self.assertIsNone(items[0]["word_id"])
        self.assertEqual(items[1]["action"], "update")
        self.assertEqual(items[1]["word_id"], "existing-word-1")
        self.assertEqual(items[2]["action"], "error")
        self.assertIn("不存在的分類", items[2]["errors"][0])

    def test_duplicate_name_in_bundle_without_id_is_error(self):
        job_id = self._upload([{"name": "重複詞"}, {"name": "重複詞"}])
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/preflight/', headers)
        items = resp.json()["report"]["items"]
        self.assertEqual(items[0]["action"], "error")
        self.assertEqual(items[1]["action"], "error")

    def test_duplicate_explicit_id_in_bundle_is_error(self):
        """_reject_duplicate_targets()：兩列都明確帶同一個既有詞條 id，
        套用時後面那列會整個覆蓋掉前面那列剛寫入的內容，卻只有最後寫入的
        結果會反映在報告裡——兩列都要被標成錯誤，不能只讓其中一列的異動
        靜默消失。"""
        job_id = self._upload([
            {"id": "existing-word-1", "name": "改名甲"},
            {"id": "existing-word-1", "name": "改名乙"},
        ])
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/preflight/', headers)
        items = resp.json()["report"]["items"]
        self.assertEqual(items[0]["action"], "error")
        self.assertEqual(items[1]["action"], "error")
        self.assertIn("existing-word-1", items[0]["errors"][0])
        self.assertIn("existing-word-1", items[1]["errors"][0])

    def test_anaphora_word_name_resolves_to_null_when_not_found(self):
        job_id = self._upload([{
            "name": "新詞2",
            "explanations": [{
                "chinese_explanation": "x",
                "sentences": [{
                    "original_sentence": "x",
                    "anaphoras": [{"items": [{"word_name": "找不到的詞"}]}],
                }],
            }],
        }])
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/preflight/', headers)
        item = resp.json()["report"]["items"][0]
        self.assertEqual(item["action"], "create")  # 標註連結不到不是錯誤，見規劃文件 P4 §5
        anaphora_item = item["payload"]["explanations"][0]["sentences"][0]["anaphoras"][0]["items"][0]
        self.assertIsNone(anaphora_item["word_id"])

    def test_anaphora_word_name_resolves_when_unique_match(self):
        job_id = self._upload([{
            "name": "新詞3",
            "explanations": [{
                "chinese_explanation": "x",
                "sentences": [{
                    "original_sentence": "x",
                    "anaphoras": [{"items": [{"word_name": "既有詞"}]}],
                }],
            }],
        }])
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/preflight/', headers)
        item = resp.json()["report"]["items"][0]
        anaphora_item = item["payload"]["explanations"][0]["sentences"][0]["anaphoras"][0]["items"][0]
        self.assertEqual(anaphora_item["word_id"], "existing-word-1")

    def test_explicit_id_targets_specific_word_even_with_different_name_in_bundle(self):
        job_id = self._upload([{"id": "existing-word-1", "name": "改名了"}])
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/preflight/', headers)
        item = resp.json()["report"]["items"][0]
        self.assertEqual(item["action"], "update")
        self.assertEqual(item["word_id"], "existing-word-1")

    def test_explicit_id_from_other_tribe_is_error(self):
        other_tribe = self.seed_tribe(tribe_id=_AMIS.id, name=_AMIS.full_name, slug=_AMIS.slug)
        self.seed_word(word_id="amis-word-1", tribe_id=other_tribe, name="amis-word")
        job_id = self._upload([{"id": "amis-word-1", "name": "x"}])
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/preflight/', headers)
        item = resp.json()["report"]["items"][0]
        self.assertEqual(item["action"], "error")


class ImportAutoCreateTaxonomiesTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()  # 這份檔案的測試量會超過每分鐘上限，避免不同測試方法互相撞到限流。
        self.client = Client()
        self.seed_tribe(tribe_id=_TAYAL.id, name=_TAYAL.full_name, slug=_TAYAL.slug)
        bundle = _minimal_bundle([{
            "name": "新詞", "explanations": [{"chinese_explanation": "x", "category_names": ["全新分類"]}],
        }])
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/import/', headers,
                               {"filename": "test.json", "bundle": bundle})
        self.job_id = resp.json()["id"]

    def test_non_owner_cannot_auto_create(self):
        with _as_role(EDITOR) as headers:
            resp = _post_json(
                self.client, f'/adminapi/dictionary/import/{self.job_id}/auto-create-taxonomies/', headers,
            )
        self.assertEqual(resp.status_code, 403)

    def test_owner_auto_create_then_preflight_resolves_cleanly(self):
        with _as_role(EDITOR) as headers:
            preflight_resp = _post_json(self.client, f'/adminapi/dictionary/import/{self.job_id}/preflight/', headers)
        self.assertEqual(preflight_resp.json()["error_count"], 1)

        with _as_role(OWNER) as headers:
            resp = _post_json(
                self.client, f'/adminapi/dictionary/import/{self.job_id}/auto-create-taxonomies/', headers,
            )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["created_taxonomies"]["category"], ["全新分類"])
        self.assertEqual(body["error_count"], 0)
        self.assertEqual(body["new_count"], 1)

        db = connect_module.SessionLocal()
        try:
            self.assertIsNotNone(db.query(m.Category).filter(m.Category.name == "全新分類").first())
        finally:
            db.close()


class ImportApproveTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()  # 這份檔案的測試量會超過每分鐘上限，避免不同測試方法互相撞到限流。
        self.client = Client()
        self.tribe_id = self.seed_tribe(tribe_id=_TAYAL.id, name=_TAYAL.full_name, slug=_TAYAL.slug)

    def _upload_and_preflight(self, words):
        bundle = _minimal_bundle(words)
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/import/', headers,
                               {"filename": "test.json", "bundle": bundle})
            job_id = resp.json()["id"]
            _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/preflight/', headers)
            _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/submit/', headers)
        return job_id

    def test_editor_cannot_approve(self):
        job_id = self._upload_and_preflight([{"name": "詞A"}])
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/approve/', headers)
        self.assertEqual(resp.status_code, 403)

    def test_approve_applies_rows_and_writes_to_dictionary_db(self):
        job_id = self._upload_and_preflight([
            {"name": "詞A", "explanations": [{"chinese_explanation": "解釋A"}]},
            {"name": "詞B", "explanations": [{"chinese_explanation": "解釋B"}]},
        ])
        with _as_role(REVIEWER) as headers:
            resp = _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/approve/', headers)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["status"], "applied")
        self.assertEqual(body["applied_count"], 2)
        self.assertEqual(body["failed_count"], 0)

        db = connect_module.SessionLocal()
        try:
            names = {w.name for w in db.query(m.Word).filter(m.Word.tribe_id == self.tribe_id).all()}
            self.assertEqual(names, {"詞A", "詞B"})
        finally:
            db.close()

        job = DictionaryImportJob.objects.get(pk=job_id)
        self.assertEqual(job.status, DictionaryImportJob.STATUS_APPLIED)
        self.assertTrue(AuditLog.objects.filter(action="approve_import_job", target_id=str(job_id)).exists())

    def test_error_rows_are_skipped_not_applied(self):
        job_id = self._upload_and_preflight([
            {"name": "好詞"},
            {"explanations": [{"category_names": ["不存在"]}], "name": "壞詞"},
        ])
        with _as_role(REVIEWER) as headers:
            resp = _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/approve/', headers)
        body = resp.json()
        self.assertEqual(body["applied_count"], 1)
        self.assertEqual(body["status"], "applied_with_errors")

        db = connect_module.SessionLocal()
        try:
            self.assertIsNone(db.query(m.Word).filter(m.Word.name == "壞詞").first())
            self.assertIsNotNone(db.query(m.Word).filter(m.Word.name == "好詞").first())
        finally:
            db.close()

    def test_one_row_failing_apply_does_not_roll_back_other_rows(self):
        """逐筆交易隔離的核心測試。resolve_import_bundle() 跟 apply_word_tree()
        本身共用大部分驗證邏輯（分類/詞類/焦點存在性、標註同族語），名稱解析
        路徑天生就不會產生「預檢覺得沒問題、套用當下才失敗」的資料（例如
        word_name 查無精準匹配時直接留 NULL，不會產生跨族語 id）——這種情境
        在真實世界通常是「兩次動作之間資料庫狀態被其他人改變」的競態，不是
        單一 request 內單執行緒能自然重現的。這裡改成直接 patch
        apply_word_tree()，讓第 2 筆呼叫時丟出例外、其餘呼叫維持真正寫入
        dictionary_db，藉此單獨驗證「approve 迴圈本身」的隔離邏輯——這正是
        這個測試真正要保證的性質，不需要先擠出一份人工資料才能測。"""
        bundle = _minimal_bundle([{"name": "詞一"}, {"name": "詞二"}, {"name": "詞三"}])
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/import/', headers,
                               {"filename": "test.json", "bundle": bundle})
            job_id = resp.json()["id"]
            _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/preflight/', headers)
            _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/submit/', headers)

        from . import dictionary_write as dw
        real_apply_word_tree = dw.apply_word_tree
        call_count = {"n": 0}

        def flaky_apply_word_tree(db, payload, word_id=None, expected_hash=None):
            call_count["n"] += 1
            if call_count["n"] == 2:
                raise dw.DictionaryWriteError("模擬第 2 筆套用失敗")
            return real_apply_word_tree(db, payload, word_id=word_id, expected_hash=expected_hash)

        with patch("adminapi.dictionary_import_views.dw.apply_word_tree", side_effect=flaky_apply_word_tree):
            with _as_role(REVIEWER) as headers:
                resp = _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/approve/', headers)

        body = resp.json()
        self.assertEqual(body["applied_count"], 2)
        self.assertEqual(body["failed_count"], 1)
        self.assertEqual(body["status"], "applied_with_errors")

        db = connect_module.SessionLocal()
        try:
            self.assertIsNotNone(db.query(m.Word).filter(m.Word.name == "詞一").first())
            self.assertIsNone(db.query(m.Word).filter(m.Word.name == "詞二").first())
            self.assertIsNotNone(db.query(m.Word).filter(m.Word.name == "詞三").first())
        finally:
            db.close()

    def test_stale_preflight_hash_rejected_with_409(self):
        job_id = self._upload_and_preflight([{"name": "詞X"}])
        job = DictionaryImportJob.objects.get(pk=job_id)
        job.preflight_hash = "sha256:stale"
        job.save(update_fields=["preflight_hash"])

        with _as_role(REVIEWER) as headers:
            resp = _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/approve/', headers)
        self.assertEqual(resp.status_code, 409)

        db = connect_module.SessionLocal()
        try:
            self.assertIsNone(db.query(m.Word).filter(m.Word.name == "詞X").first())
        finally:
            db.close()

        # 「認領後才發現不能套用」要退回 pending_review，不能卡在核准流程
        # 一開始樂觀標記的 applied 狀態——那樣審核者會看到一個從沒真的套用
        # 成功、卻顯示「已套用」的假象。
        job.refresh_from_db()
        self.assertEqual(job.status, DictionaryImportJob.STATUS_PENDING_REVIEW)

    def test_current_hash_change_since_preflight_rejected_with_409(self):
        """_attach_current_hashes()：預檢報告的雜湊現在也涵蓋每個更新目標
        「當下」的內容雜湊，不是只比對這份 bundle 自己的內容有沒有變——這裡
        驗證的是真實情境（不是竄改 job.preflight_hash 本身）：預檢之後，
        目標詞條被其他管道（例如另一筆已核准的一般提案）改過，核准時仍然
        要被擋下來，且目標詞條的內容不會被匯入覆蓋。"""
        existing_word_id = self.seed_word(word_id="existing-word-1", tribe_id=self.tribe_id, name="舊名")
        job_id = self._upload_and_preflight([{"id": existing_word_id, "name": "匯入的新名字"}])

        from . import dictionary_write as dw
        with dictionary_write_session() as db:
            dw.apply_word_tree(
                db, {"tribe_id": self.tribe_id, "name": "被其他提案改過的名字"}, word_id=existing_word_id,
            )

        with _as_role(REVIEWER) as headers:
            resp = _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/approve/', headers)
        self.assertEqual(resp.status_code, 409)

        job = DictionaryImportJob.objects.get(pk=job_id)
        self.assertEqual(job.status, DictionaryImportJob.STATUS_PENDING_REVIEW)

        db = connect_module.SessionLocal()
        try:
            word = db.query(m.Word).filter(m.Word.id == existing_word_id).one()
            self.assertEqual(word.name, "被其他提案改過的名字")
        finally:
            db.close()

    def test_cannot_approve_before_submit(self):
        bundle = _minimal_bundle([{"name": "詞Y"}])
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/import/', headers,
                               {"filename": "test.json", "bundle": bundle})
            job_id = resp.json()["id"]
            _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/preflight/', headers)
        with _as_role(REVIEWER) as headers:
            resp = _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/approve/', headers)
        self.assertEqual(resp.status_code, 409)


class ImportRejectAndWithdrawTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()  # 這份檔案的測試量會超過每分鐘上限，避免不同測試方法互相撞到限流。
        self.client = Client()
        self.seed_tribe(tribe_id=_TAYAL.id, name=_TAYAL.full_name, slug=_TAYAL.slug)

    def _pending_job(self):
        bundle = _minimal_bundle([{"name": "詞A"}])
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/dictionary/import/', headers,
                               {"filename": "test.json", "bundle": bundle})
            job_id = resp.json()["id"]
            _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/preflight/', headers)
            _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/submit/', headers)
        return job_id

    def test_reject_requires_comment(self):
        job_id = self._pending_job()
        with _as_role(REVIEWER) as headers:
            resp = _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/reject/', headers, {})
        self.assertEqual(resp.status_code, 400)

    def test_reject_sets_status(self):
        job_id = self._pending_job()
        with _as_role(REVIEWER) as headers:
            resp = _post_json(
                self.client, f'/adminapi/dictionary/import/{job_id}/reject/', headers,
                {"review_comment": "格式需要調整"},
            )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "rejected")

    def test_withdraw_returns_to_validated(self):
        job_id = self._pending_job()
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/withdraw/', headers)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "validated")


class ExportTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()  # 這份檔案的測試量會超過每分鐘上限，避免不同測試方法互相撞到限流。
        self.client = Client()
        self.tribe_id = self.seed_tribe(tribe_id=_TAYAL.id, name=_TAYAL.full_name, slug=_TAYAL.slug)

        db = connect_module.SessionLocal()
        try:
            category = m.Category(name="動物")
            db.add(category)
            word = m.Word(id="export-word-1", tribe_id=self.tribe_id, name="huzil")
            db.add(word)
            db.flush()
            explanation = m.WordExplanation(word_id=word.id, chinese_explanation="狗")
            db.add(explanation)
            db.flush()
            db.add(m.WordExplanationCategory(explanation_id=explanation.id, category_id=category.id))
            db.commit()
            self.category_id = category.id
        finally:
            db.close()

    def test_analyst_can_export_read_only(self):
        # 匯出是唯讀動作，STAFF_ROLES（含 analyst）都能用，跟建立/核准匯入
        # 工作的角色門檻不同。
        with _as_role(ANALYST) as headers:
            resp = self.client.get('/adminapi/dictionary/export/?tribe=tayal', **headers)
        self.assertEqual(resp.status_code, 200)

    def test_no_role_cannot_export(self):
        with _as_role(None) as headers:
            resp = self.client.get('/adminapi/dictionary/export/?tribe=tayal', **headers)
        self.assertEqual(resp.status_code, 403)

    def test_export_returns_bundle_with_resolved_names(self):
        with _as_role(EDITOR) as headers:
            resp = self.client.get('/adminapi/dictionary/export/?tribe=tayal', **headers)
        self.assertEqual(resp.status_code, 200)
        self.assertIn('attachment', resp['Content-Disposition'])

        bundle = json.loads(resp.content)
        self.assertEqual(bundle["schema"], "dictionary_word_bundle")
        self.assertEqual(bundle["tribe"], "tayal")
        word = bundle["words"][0]
        self.assertEqual(word["id"], "export-word-1")
        self.assertEqual(word["name"], "huzil")
        self.assertEqual(word["explanations"][0]["category_names"], ["動物"])

    def test_roundtrip_export_reimport_preflights_as_update_preserving_id(self):
        with _as_role(EDITOR) as headers:
            export_resp = self.client.get('/adminapi/dictionary/export/?tribe=tayal', **headers)
        bundle = json.loads(export_resp.content)

        with _as_role(EDITOR) as headers:
            upload_resp = _post_json(self.client, '/adminapi/dictionary/import/', headers,
                                      {"filename": "roundtrip.json", "bundle": bundle})
            job_id = upload_resp.json()["id"]
            preflight_resp = _post_json(self.client, f'/adminapi/dictionary/import/{job_id}/preflight/', headers)

        db = connect_module.SessionLocal()
        try:
            category_id = db.query(m.Category.id).filter(m.Category.name == "動物").scalar()
        finally:
            db.close()

        item = preflight_resp.json()["report"]["items"][0]
        self.assertEqual(item["action"], "update")
        self.assertEqual(item["word_id"], "export-word-1")
        self.assertEqual(item["payload"]["explanations"][0]["category_ids"], [category_id])

    def test_bulk_tribe_query_matches_single_word_query_including_deep_nesting(self):
        """匯出改成 dictionary_write.get_word_trees_for_tribe()（整批查詢
        全族語）取代逐筆呼叫 get_word_tree()——這裡直接驗證兩者對同一批
        資料回傳完全相同的結果，涵蓋來源/音檔/多筆解釋/詞類分類/圖片/
        例句/例句音檔/標註（含連結到另一筆詞條、含未連結）這些會分別觸發
        不同子查詢分組邏輯的層級，確保整批版本的 Python 端分組不會把任何
        一層的內容分到錯的詞條/解釋/例句/標註底下。"""
        db = connect_module.SessionLocal()
        try:
            pos = m.PartOfSpeech(name="動詞")
            focus = m.Focus(name="主事焦點")
            source = m.Source(name="口述採集")
            db.add_all([pos, focus, source])
            linked_word = m.Word(id="linked-word-1", tribe_id=self.tribe_id, name="kolong")
            db.add(linked_word)
            db.flush()

            rich_word = m.Word(id="rich-word-1", tribe_id=self.tribe_id, name="rich")
            db.add(rich_word)
            db.flush()
            db.add(m.WordSource(word_id=rich_word.id, source_id=source.id, sort_order=0))
            db.add(m.WordAudio(word_id=rich_word.id, external_id="a1", file_id="f1", audio_class="word", sort_order=0))

            exp1 = m.WordExplanation(word_id=rich_word.id, chinese_explanation="解釋一", sort_order=0)
            exp2 = m.WordExplanation(word_id=rich_word.id, chinese_explanation="解釋二", sort_order=1)
            db.add_all([exp1, exp2])
            db.flush()
            db.add(m.WordExplanationCategory(explanation_id=exp1.id, category_id=self.category_id))
            db.add(m.WordExplanationPos(explanation_id=exp1.id, pos_id=pos.id))
            db.add(m.WordExplanationFocus(explanation_id=exp1.id, focus_id=focus.id))
            db.add(m.WordExplanationImage(explanation_id=exp1.id, image_url="https://example.com/a.png", sort_order=0))

            sent1 = m.WordExplanationSentence(explanation_id=exp1.id, original_sentence="s1", sort_order=0)
            sent2 = m.WordExplanationSentence(explanation_id=exp2.id, original_sentence="s2", sort_order=0)
            db.add_all([sent1, sent2])
            db.flush()
            db.add(m.WordExplanationSentenceAudio(
                sentence_id=sent1.id, external_id="sa1", file_id="sf1", audio_class="sentence", sort_order=0,
            ))

            ana_linked = m.WordExplanationAnaphora(sentence_id=sent1.id, sort_order=0)
            ana_unlinked = m.WordExplanationAnaphora(sentence_id=sent1.id, sort_order=1)
            db.add_all([ana_linked, ana_unlinked])
            db.flush()
            db.add(m.WordExplanationAnaphoraItem(
                anaphora_id=ana_linked.id, word_id=linked_word.id, name="kolong", sort_order=0,
            ))
            db.add(m.WordExplanationAnaphoraItem(
                anaphora_id=ana_unlinked.id, word_id=None, name="標點", sort_order=0,
            ))
            db.commit()
            source_id = source.id
        finally:
            db.close()

        from . import dictionary_write as dw
        db = connect_module.SessionLocal()
        try:
            bulk = dw.get_word_trees_for_tribe(db, self.tribe_id)
            single = dw.get_word_tree(db, "rich-word-1")
        finally:
            db.close()

        self.assertIn("rich-word-1", bulk)
        self.assertEqual(
            json.dumps(bulk["rich-word-1"], sort_keys=True, default=str),
            json.dumps(single, sort_keys=True, default=str),
        )
        # 順帶確認深層內容確實有正確組裝到（不是兩邊剛好都是空殼而巧合相等）。
        tree = bulk["rich-word-1"]
        self.assertEqual(len(tree["explanations"]), 2)
        self.assertEqual(tree["source_ids"], [source_id])
        self.assertEqual(len(tree["audios"]), 1)
        self.assertEqual(tree["explanations"][0]["category_ids"], [self.category_id])
        self.assertEqual(len(tree["explanations"][0]["sentences"][0]["anaphoras"]), 2)
        linked_item = tree["explanations"][0]["sentences"][0]["anaphoras"][0]["items"][0]
        self.assertEqual(linked_item["word_name"], "kolong")
        unlinked_item = tree["explanations"][0]["sentences"][0]["anaphoras"][1]["items"][0]
        self.assertIsNone(unlinked_item["word_name"])
