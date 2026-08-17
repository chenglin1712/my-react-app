import json
from contextlib import contextmanager
from unittest.mock import patch

from django.test import Client, TestCase
from django.test.utils import override_settings

from config.roles import ADMIN, ANALYST, EDITOR, OWNER, REVIEWER

from .models import (
    AuditLog, IrtConfig, QuizChoiceItem, QuizClozePassage, QuizSituationItem,
    QuizSourceConfig, QuizTrueFalseItem, QuizVocabItem,
)


@contextmanager
def _as_role(role):
    """跟 tests.py 的 _as_role 完全一樣，這裡獨立一份是因為這個檔案是新的
    test*.py（Django 預設的測試探索規則），不方便直接 import tests.py 裡的
    私有 helper。"""
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": "test-uid"}
            if role is not None:
                decoded["role"] = role
            with patch("firebase_admin.auth.verify_id_token", return_value=decoded):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _post_json(client, url, headers, payload=None):
    return client.post(url, data=json.dumps(payload or {}), content_type="application/json", **headers)


def _patch_json(client, url, headers, payload):
    return client.patch(url, data=json.dumps(payload), content_type="application/json", **headers)


class QuizVocabItemTest(TestCase):
    """配合題詞彙的 CRUD + 送審流程。跟 Announcement 的關鍵差異：核准／退件
    用 CONTENT_APPROVERS（reviewer 也能核准），不是 Announcement 的
    PUBLISHERS——這是 P2 題庫管理的核心設計決定，要用測試釘住。"""

    def setUp(self):
        self.client = Client()

    def test_learner_without_staff_role_cannot_list(self):
        with _as_role(None) as headers:
            response = self.client.get('/adminapi/quiz-bank/vocab/', **headers)
        self.assertEqual(response.status_code, 403)

    def test_editor_can_create_draft(self):
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/quiz-bank/vocab/', headers, {
                "tribe": "tayal", "category": "noun", "foreign_word": "huzil", "chinese_gloss": "狗",
            })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["status"], "draft")
        self.assertEqual(response.json()["created_by"], "test-uid")

    def test_blank_foreign_word_rejected(self):
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/quiz-bank/vocab/', headers, {
                "tribe": "tayal", "category": "noun", "foreign_word": "   ", "chinese_gloss": "狗",
            })
        self.assertEqual(response.status_code, 400)

    def test_reviewer_can_approve_pending_item_announcement_would_forbid_this(self):
        # 這是整個 P2 送審流程設計的重點：Announcement 的核准/退件是
        # PUBLISHERS（owner/admin），reviewer 完全不能碰；題庫類內容改用
        # CONTENT_APPROVERS，reviewer（族語老師）必須能核准，否則整個
        # 「族語老師審定流程」的設計目的就落空了。
        item = QuizVocabItem.objects.create(
            tribe="tayal", category="noun", foreign_word="huzil", chinese_gloss="狗",
            status=QuizVocabItem.STATUS_PENDING_REVIEW, created_by="editor-uid",
        )
        with _as_role(REVIEWER) as headers:
            response = _post_json(self.client, f'/adminapi/quiz-bank/vocab/{item.pk}/approve/', headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "published")
        self.assertEqual(response.json()["reviewed_by"], "test-uid")

    def test_reviewer_can_reject_with_required_comment(self):
        item = QuizVocabItem.objects.create(
            tribe="tayal", category="noun", foreign_word="huzil", chinese_gloss="狗",
            status=QuizVocabItem.STATUS_PENDING_REVIEW, created_by="editor-uid",
        )
        with _as_role(REVIEWER) as headers:
            response = _post_json(self.client, f'/adminapi/quiz-bank/vocab/{item.pk}/reject/', headers, {})
        self.assertEqual(response.status_code, 400)  # review_comment 必填

        with _as_role(REVIEWER) as headers:
            response = _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{item.pk}/reject/', headers,
                {"review_comment": "用字需要再確認"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "rejected")

    def test_analyst_cannot_approve(self):
        item = QuizVocabItem.objects.create(
            tribe="tayal", category="noun", foreign_word="huzil", chinese_gloss="狗",
            status=QuizVocabItem.STATUS_PENDING_REVIEW, created_by="editor-uid",
        )
        with _as_role(ANALYST) as headers:
            response = _post_json(self.client, f'/adminapi/quiz-bank/vocab/{item.pk}/approve/', headers)
        self.assertEqual(response.status_code, 403)

    def test_full_lifecycle_submit_approve_unpublish(self):
        item = QuizVocabItem.objects.create(
            tribe="tayal", category="noun", foreign_word="huzil", chinese_gloss="狗",
            status=QuizVocabItem.STATUS_DRAFT, created_by="editor-uid",
        )
        with _as_role(EDITOR) as headers:
            submit_resp = _post_json(self.client, f'/adminapi/quiz-bank/vocab/{item.pk}/submit/', headers)
        self.assertEqual(submit_resp.json()["status"], "pending_review")

        with _as_role(OWNER) as headers:
            approve_resp = _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{item.pk}/approve/', headers, {"review_comment": ""},
            )
        self.assertEqual(approve_resp.json()["status"], "published")

        # 已啟用的內容退回草稿——沒有 Announcement 的 unpublished 中介狀態。
        with _as_role(OWNER) as headers:
            unpublish_resp = _post_json(self.client, f'/adminapi/quiz-bank/vocab/{item.pk}/unpublish/', headers)
        self.assertEqual(unpublish_resp.json()["status"], "draft")

    def test_cannot_update_pending_review_item(self):
        item = QuizVocabItem.objects.create(
            tribe="tayal", category="noun", foreign_word="huzil", chinese_gloss="狗",
            status=QuizVocabItem.STATUS_PENDING_REVIEW, created_by="editor-uid",
        )
        with _as_role(EDITOR) as headers:
            response = _patch_json(
                self.client, f'/adminapi/quiz-bank/vocab/{item.pk}/', headers, {"chinese_gloss": "小狗"},
            )
        self.assertEqual(response.status_code, 409)

    def test_delete_requires_publishers_and_draft_status(self):
        item = QuizVocabItem.objects.create(
            tribe="tayal", category="noun", foreign_word="huzil", chinese_gloss="狗",
            status=QuizVocabItem.STATUS_DRAFT, created_by="editor-uid",
        )
        with _as_role(EDITOR) as headers:
            forbidden_resp = self.client.delete(f'/adminapi/quiz-bank/vocab/{item.pk}/', **headers)
        self.assertEqual(forbidden_resp.status_code, 403)

        with _as_role(OWNER) as headers:
            ok_resp = self.client.delete(f'/adminapi/quiz-bank/vocab/{item.pk}/', **headers)
        self.assertEqual(ok_resp.status_code, 200)
        self.assertFalse(QuizVocabItem.objects.filter(pk=item.pk).exists())

    def test_category_and_tribe_filters(self):
        QuizVocabItem.objects.create(
            tribe="tayal", category="noun", foreign_word="huzil", chinese_gloss="狗", created_by="u",
        )
        QuizVocabItem.objects.create(
            tribe="tayal", category="verb", foreign_word="uwah", chinese_gloss="來", created_by="u",
        )
        QuizVocabItem.objects.create(
            tribe="amis", category="noun", foreign_word="wacu", chinese_gloss="狗", created_by="u",
        )
        with _as_role(OWNER) as headers:
            response = self.client.get('/adminapi/quiz-bank/vocab/?tribe=tayal&category=noun', **headers)
        self.assertEqual(response.json()["count"], 1)

    def test_approve_writes_audit_log_with_correct_target_type(self):
        item = QuizVocabItem.objects.create(
            tribe="tayal", category="noun", foreign_word="huzil", chinese_gloss="狗",
            status=QuizVocabItem.STATUS_PENDING_REVIEW, created_by="editor-uid",
        )
        with _as_role(REVIEWER) as headers:
            _post_json(self.client, f'/adminapi/quiz-bank/vocab/{item.pk}/approve/', headers)
        log = AuditLog.objects.filter(target_type="quiz_vocab_item", action="approve").first()
        self.assertIsNotNone(log)
        self.assertEqual(log.target_id, str(item.pk))


class QuizClozePassageTest(TestCase):
    def setUp(self):
        self.client = Client()

    def _valid_payload(self):
        return {
            "tribe": "tayal",
            "passage_foreign": "Lokah! {blank1}",
            "passage_chinese": "你好！",
            "blanks": {"blank1": {"options": ["a", "b", "c", "d"], "answer": 1}},
        }

    def test_editor_can_create_valid_passage(self):
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/quiz-bank/cloze/', headers, self._valid_payload())
        self.assertEqual(response.status_code, 201)

    def test_missing_blank_marker_in_passage_rejected(self):
        payload = self._valid_payload()
        payload["passage_foreign"] = "Lokah! 沒有標記"
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/quiz-bank/cloze/', headers, payload)
        self.assertEqual(response.status_code, 400)

    def test_wrong_option_count_rejected(self):
        payload = self._valid_payload()
        payload["blanks"]["blank1"]["options"] = ["a", "b"]
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/quiz-bank/cloze/', headers, payload)
        self.assertEqual(response.status_code, 400)

    def test_answer_out_of_range_rejected(self):
        payload = self._valid_payload()
        payload["blanks"]["blank1"]["answer"] = 5
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/quiz-bank/cloze/', headers, payload)
        self.assertEqual(response.status_code, 400)

    def test_reviewer_can_approve(self):
        passage = QuizClozePassage.objects.create(
            tribe="tayal", passage_foreign="Lokah! {blank1}", passage_chinese="你好！",
            blanks={"blank1": {"options": ["a", "b", "c", "d"], "answer": 1}},
            status=QuizClozePassage.STATUS_PENDING_REVIEW, created_by="editor-uid",
        )
        with _as_role(REVIEWER) as headers:
            response = _post_json(self.client, f'/adminapi/quiz-bank/cloze/{passage.pk}/approve/', headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "published")


class QuizSituationItemTest(TestCase):
    def setUp(self):
        self.client = Client()

    def _valid_payload(self):
        return {
            "tribe": "tayal",
            "scenario_chinese": "長輩遞給你食物，你要怎麼用族語回應？",
            "options": [
                {"foreign": "Msoya' saku wah", "chinese": "我很喜歡"},
                {"foreign": "Baq su bhoq iyat", "chinese": "你不會嗎"},
                {"foreign": "Ini uzi", "chinese": "沒有／不用了"},
                {"foreign": "Yasa hiya", "chinese": "就是那個"},
            ],
            "answer": 1,
        }

    def test_editor_can_create_valid_item(self):
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/quiz-bank/situations/', headers, self._valid_payload())
        self.assertEqual(response.status_code, 201)

    def test_wrong_option_count_rejected(self):
        payload = self._valid_payload()
        payload["options"] = payload["options"][:3]
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/quiz-bank/situations/', headers, payload)
        self.assertEqual(response.status_code, 400)

    def test_answer_out_of_range_rejected(self):
        payload = self._valid_payload()
        payload["answer"] = 0
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/quiz-bank/situations/', headers, payload)
        self.assertEqual(response.status_code, 400)

    def test_full_review_cycle(self):
        with _as_role(EDITOR) as headers:
            create_resp = _post_json(self.client, '/adminapi/quiz-bank/situations/', headers, self._valid_payload())
        item_id = create_resp.json()["id"]

        with _as_role(EDITOR) as headers:
            _post_json(self.client, f'/adminapi/quiz-bank/situations/{item_id}/submit/', headers)

        with _as_role(REVIEWER) as headers:
            approve_resp = _post_json(
                self.client, f'/adminapi/quiz-bank/situations/{item_id}/approve/', headers, {"review_comment": ""},
            )
        self.assertEqual(approve_resp.json()["status"], "published")


class QuizTrueFalseItemTest(TestCase):
    """初級「是非題」的 CRUD + 送審流程，跟 QuizVocabItem 等其他題庫內容
    共用同一套 _make_content_views 工廠，這裡只驗證這個內容型別特有的
    欄位驗證（audio_url／image_url 不能空白），流程本身已經被
    QuizVocabItemTest 完整涵蓋，不重複測。"""

    def setUp(self):
        self.client = Client()

    def _valid_payload(self):
        return {
            "tribe": "tayal",
            "question_ab": "qani ga, huzil.",
            "question_ch": "這是狗。",
            "audio_url": "https://res.cloudinary.com/demo/video/upload/a.mp3",
            "image_url": "https://res.cloudinary.com/demo/image/upload/a.png",
            "answer": QuizTrueFalseItem.ANSWER_TRUE,
        }

    def test_editor_can_create_valid_item(self):
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/quiz-bank/true-false/', headers, self._valid_payload())
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["status"], "draft")

    def test_blank_audio_url_rejected(self):
        payload = self._valid_payload()
        payload["audio_url"] = ""
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/quiz-bank/true-false/', headers, payload)
        self.assertEqual(response.status_code, 400)

    def test_origin_key_not_writable_via_serializer(self):
        # origin_key 只給 migrate_quiz_level12_to_db 用 ORM 直接寫入
        # （見 serializers.py 的說明），一般 create 帶這個欄位應該被忽略，
        # 不能讓後台人員自建的題項意外撞上遷移資料的去重鍵。
        payload = self._valid_payload()
        payload["origin_key"] = "1_8"
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/quiz-bank/true-false/', headers, payload)
        self.assertEqual(response.status_code, 201)
        created = QuizTrueFalseItem.objects.get(pk=response.json()["id"])
        self.assertIsNone(created.origin_key)

    def test_reviewer_can_approve(self):
        item = QuizTrueFalseItem.objects.create(
            tribe="tayal", question_ab="qani ga, huzil.", question_ch="這是狗。",
            audio_url="https://res.cloudinary.com/demo/video/upload/a.mp3",
            image_url="https://res.cloudinary.com/demo/image/upload/a.png",
            answer=QuizTrueFalseItem.ANSWER_TRUE,
            status=QuizTrueFalseItem.STATUS_PENDING_REVIEW, created_by="editor-uid",
        )
        with _as_role(REVIEWER) as headers:
            response = _post_json(self.client, f'/adminapi/quiz-bank/true-false/{item.pk}/approve/', headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "published")


class QuizChoiceItemTest(TestCase):
    def setUp(self):
        self.client = Client()

    def _valid_payload(self):
        return {
            "tribe": "tayal",
            "question_ab": "nyux qutux huzil maku.",
            "question_ch": "我有一隻狗。",
            "image_a_url": "https://res.cloudinary.com/demo/image/upload/a.png",
            "image_b_url": "https://res.cloudinary.com/demo/image/upload/b.png",
            "image_c_url": "https://res.cloudinary.com/demo/image/upload/c.png",
            "answer": 1,
        }

    def test_editor_can_create_valid_item(self):
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/quiz-bank/choice/', headers, self._valid_payload())
        self.assertEqual(response.status_code, 201)

    def test_answer_out_of_range_rejected(self):
        payload = self._valid_payload()
        payload["answer"] = 4
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/quiz-bank/choice/', headers, payload)
        self.assertEqual(response.status_code, 400)

    def test_blank_image_url_rejected(self):
        payload = self._valid_payload()
        payload["image_b_url"] = ""
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/quiz-bank/choice/', headers, payload)
        self.assertEqual(response.status_code, 400)

    def test_reviewer_can_approve(self):
        item = QuizChoiceItem.objects.create(
            tribe="tayal", question_ab="nyux qutux huzil maku.", question_ch="我有一隻狗。",
            image_a_url="https://res.cloudinary.com/demo/image/upload/a.png",
            image_b_url="https://res.cloudinary.com/demo/image/upload/b.png",
            image_c_url="https://res.cloudinary.com/demo/image/upload/c.png",
            answer=1, status=QuizChoiceItem.STATUS_PENDING_REVIEW, created_by="editor-uid",
        )
        with _as_role(REVIEWER) as headers:
            response = _post_json(self.client, f'/adminapi/quiz-bank/choice/{item.pk}/approve/', headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "published")


class QuizSourceConfigTest(TestCase):
    def setUp(self):
        self.client = Client()
        QuizSourceConfig.objects.create(tribe="tayal", dialect_id=6, display_name="泰雅語 - 賽考利克泰雅語")

    def test_staff_can_list(self):
        with _as_role(ANALYST) as headers:
            response = self.client.get('/adminapi/quiz-bank/sources/', **headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["results"]), 1)

    def test_editor_can_update_dialect_id(self):
        with _as_role(EDITOR) as headers:
            response = _patch_json(
                self.client, '/adminapi/quiz-bank/sources/tayal/', headers, {"dialect_id": 99},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["dialect_id"], 99)
        self.assertEqual(response.json()["updated_by"], "test-uid")

    def test_reviewer_cannot_update(self):
        with _as_role(REVIEWER) as headers:
            response = _patch_json(
                self.client, '/adminapi/quiz-bank/sources/tayal/', headers, {"dialect_id": 99},
            )
        self.assertEqual(response.status_code, 403)

    def test_update_writes_audit_log(self):
        with _as_role(EDITOR) as headers:
            _patch_json(self.client, '/adminapi/quiz-bank/sources/tayal/', headers, {"dialect_id": 99})
        log = AuditLog.objects.filter(target_type="quiz_source_config", action="update").first()
        self.assertIsNotNone(log)


class IrtConfigTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_default_values_match_existing_fastapi_hardcoded_constants(self):
        # 這組預設值必須跟 backend/fastAPI/routes/quiz.py 模組頂部原本寫死的
        # 數字完全一致，確保新增這張表當下，FastAPI 那邊實際算分行為不變。
        config = IrtConfig.load()
        self.assertEqual(config.total_questions, 10)
        self.assertEqual(config.alpha0, 1.0)
        self.assertEqual(config.beta0, 1.0)
        self.assertEqual(config.default_guess, 0.25)
        self.assertEqual(config.learning_rate, 0.08)
        self.assertEqual(config.dq_alpha, 0.45)
        self.assertEqual(config.dq_beta, 0.35)
        self.assertEqual(config.dq_gamma, 0.20)
        self.assertEqual(config.type_aq_word_translate, 1.2)
        self.assertEqual(config.type_aq_word_match, 1.0)
        self.assertEqual(config.type_aq_sentence_fill, 0.9)
        self.assertEqual(config.type_aq_sentence_order, 1.1)

    def test_staff_can_view(self):
        with _as_role(ANALYST) as headers:
            response = self.client.get('/adminapi/irt-config/', **headers)
        self.assertEqual(response.status_code, 200)

    def test_only_publishers_can_update(self):
        with _as_role(EDITOR) as headers:
            response = _patch_json(self.client, '/adminapi/irt-config/', headers, {"total_questions": 15})
        self.assertEqual(response.status_code, 403)

        with _as_role(ADMIN) as headers:
            response = _patch_json(self.client, '/adminapi/irt-config/', headers, {"total_questions": 15})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total_questions"], 15)

    def test_total_questions_out_of_range_rejected(self):
        with _as_role(OWNER) as headers:
            response = _patch_json(self.client, '/adminapi/irt-config/', headers, {"total_questions": 999})
        self.assertEqual(response.status_code, 400)

    def test_default_guess_out_of_range_rejected(self):
        with _as_role(OWNER) as headers:
            response = _patch_json(self.client, '/adminapi/irt-config/', headers, {"default_guess": 1.5})
        self.assertEqual(response.status_code, 400)

    def test_public_endpoint_does_not_require_login(self):
        response = self.client.get('/adminapi/public/irt-config/')
        self.assertEqual(response.status_code, 200)
        self.assertIn("total_questions", response.json())

    def test_public_endpoint_excludes_admin_metadata(self):
        response = self.client.get('/adminapi/public/irt-config/')
        data = response.json()
        self.assertNotIn("updated_by", data)
        self.assertNotIn("updated_at", data)

    def test_update_writes_audit_log(self):
        with _as_role(OWNER) as headers:
            _patch_json(self.client, '/adminapi/irt-config/', headers, {"total_questions": 12})
        log = AuditLog.objects.filter(target_type="irt_config", action="update").first()
        self.assertIsNotNone(log)
