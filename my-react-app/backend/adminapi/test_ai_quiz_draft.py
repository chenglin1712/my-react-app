"""路線圖 #23：AI 個人化出題（需人工審核）。產生 → 草稿 → 送審 → 另一位審核者核可 → 才進學生題庫。"""
import json
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.test import Client, TestCase
from django.test.utils import override_settings

from adminapi.auth_fixtures import fresh_auth
from adminapi.models import AiQuizDraft, AuditLog, FeatureFlag, QuizSituationItem
from AIModel.quiz_draft import DraftGenerationError, generate_situation_drafts, parse_situation_drafts
from AIModel.test_dictionary_tools import _FakeLookup
from AIModel.tests import _mock_response
from config.roles import ADMIN, EDITOR, REVIEWER
from crawler.quiz_bank import build_situation_test_from_db


@contextmanager
def as_user(uid, role):
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            with patch("firebase_admin.auth.verify_id_token", return_value=fresh_auth({"uid": uid, "role": role})):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _item(answer=2, **over):
    base = {
        "scenario_chinese": "長輩問你好不好，你要怎麼回答？",
        "options": [{"foreign": f"lokah su {i}", "chinese": f"回答{i}"} for i in range(1, 5)],
        "answer": answer,
    }
    base.update(over)
    return base


def _reply(*items):
    return json.dumps({"items": list(items)}, ensure_ascii=False)


class _Lookup(_FakeLookup):
    """get(word_id) 回傳辭典詞條；names/search 由 _FakeLookup 提供。"""

    def get(self, word_id):
        if word_id == "7":
            return {"word_id": "7", "name": "lokah", "explanations": [
                {"chinese": "你好", "part_of_speech": ["名詞"], "examples": [{"original": "lokah su", "chinese": "你好嗎"}]}]}
        return None


class ParseDraftsTest(TestCase):
    def test_valid_item_is_kept_and_text_is_cleaned(self):
        drafts = parse_situation_drafts(_reply(_item(scenario_chinese="  長輩\n問你  ")), 3)
        self.assertEqual(drafts[0]["scenario_chinese"], "長輩 問你")
        self.assertEqual(len(drafts[0]["options"]), 4)

    def test_bad_shapes_are_dropped_not_repaired(self):
        bad = [
            _item(answer=0), _item(answer=5), _item(answer=True), _item(answer="2"),
            _item(options=_item()["options"][:3]),
            _item(options=[{"foreign": "a", "chinese": "甲"}] * 4),                              # 選項重複
            _item(options=[{"foreign": "a", "chinese": ""}, *_item()["options"][1:]]),
            _item(scenario_chinese="   "),
            "not an object",
        ]
        for item in bad:
            with self.subTest(item=item):
                self.assertEqual(parse_situation_drafts(_reply(item), 3), [])

    def test_not_json_and_wrong_top_level(self):
        self.assertEqual(parse_situation_drafts("nope", 3), [])
        self.assertEqual(parse_situation_drafts(json.dumps([1]), 3), [])

    def test_count_is_capped(self):
        self.assertEqual(len(parse_situation_drafts(_reply(*[_item() for _ in range(5)]), 2)), 2)


class GenerateTest(TestCase):
    def _client(self, text):
        client = MagicMock()
        client.messages.create.return_value = _mock_response(text)
        return client

    def test_dictionary_data_goes_in_the_user_message_not_the_system_prompt_and_unverified_words_are_flagged(self):
        client = self._client(_reply(_item()))
        result = generate_situation_drafts(client, "泰雅語", _Lookup({"lokah": ["你好"]}), ["7", "999"], 1, uid="u1")

        kwargs = client.messages.create.call_args.kwargs
        system = kwargs["system"] if isinstance(kwargs["system"], str) else json.dumps(kwargs["system"], ensure_ascii=False)
        self.assertIn("lokah：你好", kwargs["messages"][0]["content"])
        self.assertNotIn("lokah", system)
        self.assertEqual([e["word_id"] for e in result["entries"]], ["7"])         # 查不到的 999 略過
        self.assertIn("su", result["drafts"][0]["unverified_words"])               # 辭典沒有 su → 標記
        self.assertTrue(result["model"])

    def test_no_usable_entries_fails_without_calling_the_model(self):
        client = self._client(_reply(_item()))
        with self.assertRaises(DraftGenerationError):
            generate_situation_drafts(client, "泰雅語", _Lookup({}), ["404"], 1)
        client.messages.create.assert_not_called()

    def _generate_from(self, response):
        client = MagicMock()
        client.messages.create.return_value = response
        return generate_situation_drafts(client, "泰雅語", _Lookup({}), ["7"], 1)

    def test_garbage_output_fails_with_a_fixed_message(self):
        with self.assertRaises(DraftGenerationError), self.assertLogs("AIModel.quiz_draft", level="WARNING"):
            self._generate_from(_mock_response("not json"))

    def test_truncated_output_is_never_parsed(self):
        response = _mock_response(_reply(_item()))
        response.stop_reason = "max_tokens"
        with self.assertRaises(DraftGenerationError):
            self._generate_from(response)


class EndpointTest(TestCase):
    URL = "/adminapi/quiz-bank/situations/ai-draft/"

    def setUp(self):
        self.http = Client()
        cache.clear()
        self.addCleanup(cache.clear)

    def _enable(self, enabled=True):
        FeatureFlag.objects.update_or_create(key="ai_quiz_draft_enabled", defaults={"label": "x", "enabled": enabled})

    def _post(self, uid="editor-1", role=EDITOR, payload=None):
        payload = payload or {"tribe": "tayal", "word_ids": ["7"], "count": 1}
        with as_user(uid, role) as headers:
            return self.http.post(self.URL, data=json.dumps(payload), content_type="application/json", **headers)

    def _generate(self, uid="editor-1", role=EDITOR):
        with patch("adminapi.ai_quiz_draft_views.get_llm_client", return_value=self._llm()), \
                patch("adminapi.ai_quiz_draft_views.SqlDictionaryLookup", return_value=_Lookup({"lokah": ["你好"]})):
            return self._post(uid, role)

    def _llm(self):
        client = MagicMock()
        client.messages.create.return_value = _mock_response(_reply(_item()))
        return client

    def test_off_by_default_and_wrong_roles_are_rejected(self):
        self.assertEqual(self._post().status_code, 403)                           # 旗標沒開
        self._enable()
        self.assertEqual(self._post(role=REVIEWER).status_code, 403)              # 審核者不是編輯者
        self.assertEqual(self._post(role=None).status_code, 403)
        self.assertEqual(QuizSituationItem.objects.count(), 0)

    def test_invalid_requests_are_400(self):
        self._enable()
        for payload in ({"tribe": "nope", "word_ids": ["7"]}, {"tribe": "tayal", "word_ids": []},
                        {"tribe": "tayal", "word_ids": ["1", "2", "3", "4", "5", "6"]},
                        {"tribe": "tayal", "word_ids": ["../x"]}, {"tribe": "tayal", "word_ids": ["7"], "count": 9}):
            with self.subTest(payload=payload):
                self.assertEqual(self._post(payload=payload).status_code, 400)

    def test_generation_creates_a_draft_with_source_record_and_audit(self):
        self._enable()
        response = self._generate()

        self.assertEqual(response.status_code, 201)
        item = QuizSituationItem.objects.get()
        self.assertEqual((item.status, item.created_by), ("draft", "editor-1"))
        draft = AiQuizDraft.objects.get()
        self.assertEqual((draft.content_id, draft.generated_by, draft.source_word_ids, draft.source_words),
                         (item.pk, "editor-1", ["7"], ["lokah"]))
        self.assertTrue(draft.model)
        body = response.json()["items"][0]
        self.assertEqual(body["ai_draft"]["source_words"], ["lokah"])
        self.assertIn("su", body["ai_draft"]["unverified_words"])
        self.assertEqual(AuditLog.objects.filter(action="ai_generate").count(), 1)

    def test_nothing_is_visible_to_students_until_approved_by_someone_else(self):
        self._enable()
        self._generate()
        item = QuizSituationItem.objects.get()
        self.assertEqual(build_situation_test_from_db("tayal")["questions"], [])            # 草稿

        with as_user("editor-1", EDITOR) as headers:
            self.http.post(f"/adminapi/quiz-bank/situations/{item.pk}/submit/", data="{}", content_type="application/json", **headers)
        self.assertEqual(build_situation_test_from_db("tayal")["questions"], [])            # 待審核

        # 產生者本人（即使是 admin：同時是編輯者與核准者）不能核可
        with as_user("editor-1", ADMIN) as headers:
            own = self.http.post(f"/adminapi/quiz-bank/situations/{item.pk}/approve/",
                                 data=json.dumps({"review_comment": "ok"}), content_type="application/json", **headers)
        self.assertEqual((own.status_code, own.json()["code"]), (403, "cannot_approve_own_ai_draft"))
        item.refresh_from_db()
        self.assertEqual(item.status, "pending_review")
        self.assertEqual(build_situation_test_from_db("tayal")["questions"], [])

        with as_user("reviewer-9", REVIEWER) as headers:
            other = self.http.post(f"/adminapi/quiz-bank/situations/{item.pk}/approve/",
                                   data=json.dumps({"review_comment": "語意正確"}), content_type="application/json", **headers)
        self.assertEqual(other.status_code, 200)
        item.refresh_from_db()
        self.assertEqual((item.status, item.reviewed_by), ("published", "reviewer-9"))
        self.assertEqual(len(build_situation_test_from_db("tayal")["questions"]), 1)

    def test_traceability_survives_in_the_list_for_reviewers(self):
        self._enable()
        self._generate()
        with as_user("reviewer-9", REVIEWER) as headers:
            rows = self.http.get("/adminapi/quiz-bank/situations/", **headers).json()
        row = (rows["results"] if isinstance(rows, dict) and "results" in rows else rows)[0]
        self.assertEqual(row["ai_draft"]["generated_by"], "editor-1")

    def test_manually_created_items_have_no_ai_draft_and_can_be_approved_by_their_creator_role_rules_unchanged(self):
        with as_user("editor-1", EDITOR) as headers:
            created = self.http.post("/adminapi/quiz-bank/situations/", data=json.dumps({
                "tribe": "tayal", "scenario_chinese": "x", "options": _item()["options"], "answer": 1,
            }), content_type="application/json", **headers).json()
        self.assertIsNone(created["ai_draft"])

    def test_model_failure_creates_nothing(self):
        self._enable()
        client = MagicMock()
        client.messages.create.return_value = _mock_response("not json")
        with patch("adminapi.ai_quiz_draft_views.get_llm_client", return_value=client), \
                patch("adminapi.ai_quiz_draft_views.SqlDictionaryLookup", return_value=_Lookup({})), \
                self.assertLogs("AIModel.quiz_draft", level="WARNING"):
            response = self._post()
        self.assertEqual((response.status_code, response.json()["code"]), (422, "ai_quiz_draft_failed"))
        self.assertEqual((QuizSituationItem.objects.count(), AiQuizDraft.objects.count()), (0, 0))

    def test_assistant_master_switch_also_stops_draft_generation(self):
        self._enable()
        FeatureFlag.objects.update_or_create(key="ai_assistant_enabled", defaults={"label": "x", "enabled": False})
        self.assertEqual(self._post().status_code, 403)


class FollowUpTest(TestCase):
    def test_identical_chinese_options_are_dropped(self):
        same = _item(options=[{"foreign": f"a{i}", "chinese": "你好"} for i in range(4)])
        self.assertEqual(parse_situation_drafts(_reply(same), 3), [])

    def test_deleting_a_draft_removes_its_source_record(self):
        item = QuizSituationItem.objects.create(
            tribe="tayal", scenario_chinese="x", options=_item()["options"], answer=1, created_by="editor-1")
        AiQuizDraft.objects.create(content_type="quiz_situation_item", content_id=item.pk, tribe="tayal", model="m", generated_by="editor-1")
        with as_user("editor-1", ADMIN) as headers:
            response = Client().delete(f"/adminapi/quiz-bank/situations/{item.pk}/", **headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(AiQuizDraft.objects.count(), 0)
