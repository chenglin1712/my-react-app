"""路線圖 #6：模型拒答時，AI 對話回 200 與固定說明，不是通用的 502。"""
import json
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.test import Client, TestCase

from AIModel.services import run_review_tayal_chat, run_tayal_chat, sign_reply
from AIModel.test_dictionary_tools import _FakeLookup, _tool_use_response
from AIModel.tests import _mock_response
from config.llm import REFUSAL_MESSAGE


def _refused_client(*responses):
    client = MagicMock()
    refused = _mock_response("")
    refused.stop_reason = "refusal"
    refused.stop_details = MagicMock(category="other")
    client.messages.create.side_effect = list(responses) or [refused]
    return client


class RefusalServiceTests(TestCase):
    def test_chat_refusal_returns_the_fixed_message_flagged_and_signed(self):
        result = run_tayal_chat(_refused_client(), "泰雅語", "某個被拒答的問題", {}, uid="u1")
        self.assertEqual(result["message"], REFUSAL_MESSAGE)
        self.assertTrue(result["refused"])
        self.assertEqual(result["sig"], sign_reply("u1", REFUSAL_MESSAGE))   # 之後當歷史送回時驗證得過

    def test_refusal_in_the_middle_of_a_tool_loop_also_gets_the_fixed_message(self):
        refused = _mock_response("")
        refused.stop_reason = "refusal"
        refused.stop_details = None
        client = _refused_client(_tool_use_response(("search_words", {"keywords": ["lokah"]})), refused)
        result = run_tayal_chat(client, "泰雅語", "lokah", {}, lookup=_FakeLookup({"lokah": ["你好"]}))
        self.assertEqual(result["message"], REFUSAL_MESSAGE)
        self.assertEqual(client.messages.create.call_count, 2)

    def test_study_plan_refusal_is_flagged_like_any_other_refusal_and_not_retried(self):
        client = _refused_client()
        result = run_tayal_chat(client, "泰雅語", "幫我排一個一週讀書計畫", {}, uid="u1")
        self.assertEqual(result["message"], REFUSAL_MESSAGE)
        self.assertTrue(result["refused"])
        self.assertEqual(client.messages.create.call_count, 1)

    def test_normal_replies_are_not_flagged(self):
        client = MagicMock()
        client.messages.create.return_value = _mock_response("你好")
        self.assertNotIn("refused", run_tayal_chat(client, "泰雅語", "你好", {}))

    def test_review_refusal_keeps_the_word_table_and_replaces_only_the_ai_note(self):
        words = [{"tayal": "lokah", "chinese": "你好", "audio": ""}]
        result = run_review_tayal_chat(_refused_client(), "泰雅語", "lokah su", words)
        self.assertEqual(result["translation"], REFUSAL_MESSAGE)
        self.assertEqual(result["words"], words)
        self.assertEqual(result["original"], "lokah su")
        self.assertTrue(result["refused"])


class RefusalViewTests(TestCase):
    def setUp(self):
        cache.clear()

    @patch("AIModel.views.load_profile", return_value=None)
    @patch("AIModel.views.verify_firebase_token", return_value=({"uid": "u1"}, None))
    @patch("AIModel.views._get_client")
    def test_the_endpoint_answers_200_not_502(self, get_client, _verify, _profile):
        get_client.return_value = _refused_client()
        response = Client().post(
            "/AIModel/tayal_chat/", data=json.dumps({"message": "某個被拒答的問題"}), content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["message"], REFUSAL_MESSAGE)
        self.assertTrue(body["refused"])
        self.assertEqual(body["sig"], sign_reply("u1", REFUSAL_MESSAGE))
        self.assertEqual(body["quota"]["remaining"], body["quota"]["limit"] - 1)   # 拒答仍算用掉一次提問
