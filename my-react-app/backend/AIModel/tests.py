import json

from django.core.cache import cache
from django.test import TestCase, Client, override_settings
from unittest.mock import patch, MagicMock

from AIModel.views import search_tayal_words, search_tayal_words_bulk
from AIModel.services import run_tayal_chat, run_review_tayal_chat


class _FakeWord:
    def __init__(self, id, name):
        self.id = id
        self.name = name


class SearchTayalWordsTest(TestCase):
    """測試 search_tayal_words / search_tayal_words_bulk 的組裝邏輯（不依賴真實資料庫）。
    這兩個函式底層用 SQLAlchemy 查 fastAPI 的 Word/word_explanation/word_audio 表，
    這裡 mock 掉 SessionLocal 與 word_data.py 的查詢函式，只驗證組裝結果。"""

    def _mock_session(self, mock_session_local, words):
        mock_db = MagicMock()
        mock_query = mock_db.query.return_value
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.all.return_value = words
        mock_session_local.return_value = mock_db
        return mock_db

    @patch("AIModel.views.load_audio_items_for_words")
    @patch("AIModel.views.load_explanation_items_for_words")
    @patch("AIModel.views.SessionLocal")
    def test_existing_word_returns_list(self, mock_session_local, mock_explanations, mock_audios):
        self._mock_session(mock_session_local, [_FakeWord("w1", "cyux")])
        mock_explanations.return_value = {"w1": [{"chineseExplanation": "happy"}]}
        mock_audios.return_value = {"w1": [{"fileId": "file123"}]}

        result = search_tayal_words("cyux", limit=1)

        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["tayal"], "cyux")
        self.assertEqual(result[0]["chinese"], "happy")

    @patch("AIModel.views.load_audio_items_for_words")
    @patch("AIModel.views.load_explanation_items_for_words")
    @patch("AIModel.views.SessionLocal")
    def test_nonexistent_word_returns_empty(self, mock_session_local, mock_explanations, mock_audios):
        self._mock_session(mock_session_local, [])
        mock_explanations.return_value = {}
        mock_audios.return_value = {}

        result = search_tayal_words("not_exist", limit=1)

        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 0)

    @patch("AIModel.views.SessionLocal")
    def test_db_connection_failure_returns_empty(self, mock_session_local):
        mock_db = MagicMock()
        mock_db.query.side_effect = Exception("DB connection failed")
        mock_session_local.return_value = mock_db

        result = search_tayal_words("cyux", limit=1)

        self.assertEqual(result, [])

    @patch("AIModel.views.load_audio_items_for_words")
    @patch("AIModel.views.load_explanation_items_for_words")
    @patch("AIModel.views.SessionLocal")
    def test_bulk_search_returns_dict(self, mock_session_local, mock_explanations, mock_audios):
        self._mock_session(mock_session_local, [_FakeWord("w2", "mami")])
        mock_explanations.return_value = {"w2": [{"chineseExplanation": "mother"}]}
        mock_audios.return_value = {"w2": [{"fileId": "file456"}]}

        result = search_tayal_words_bulk(["mami"])

        self.assertIn("mami", result)
        self.assertEqual(result["mami"]["chinese"], "mother")

    def test_bulk_search_empty_input(self):
        result = search_tayal_words_bulk([])
        self.assertEqual(result, {})


def _mock_chat_client(reply_text="哈囉"):
    mock_client = MagicMock()
    block = MagicMock(type="text", text=reply_text)
    mock_client.messages.create.return_value = MagicMock(stop_reason="end_turn", content=[block])
    return mock_client


class TayalChatViewTest(TestCase):
    """tayal_chat 的請求驗證（TayalChatSerializer）與例外處理（稽核修正：
    原本 user_stats／tribe 沒驗證型別長度就直接組進 prompt，例外處理直接把
    str(e) 回給前端且沒有寫 log）。"""

    def setUp(self):
        self.client_http = Client()
        cache.clear()

    def _post(self, payload):
        return self.client_http.post(
            '/AIModel/tayal_chat/',
            data=json.dumps(payload),
            content_type='application/json',
        )

    def test_malformed_json_returns_400(self):
        response = self.client_http.post(
            '/AIModel/tayal_chat/', data="not valid json", content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)

    def test_invalid_tribe_returns_400(self):
        response = self._post({"message": "hi", "tribe": "not-a-real-tribe"})
        self.assertEqual(response.status_code, 400)

    def test_oversized_common_errors_list_returns_400(self):
        response = self._post({
            "message": "hi",
            "user_stats": {"common_errors": ["x"] * 21},
        })
        self.assertEqual(response.status_code, 400)

    @patch("AIModel.views._get_client")
    def test_upstream_failure_returns_generic_message_and_logs(self, mock_get_client):
        mock_client = MagicMock()
        mock_client.messages.create.side_effect = Exception("internal api key xyz")
        mock_get_client.return_value = mock_client

        with self.assertLogs("AIModel.views", level="ERROR") as logs:
            response = self._post({"message": "hi"})

        self.assertEqual(response.status_code, 502)
        self.assertNotIn("internal api key xyz", response.json()["detail"])
        self.assertTrue(any("tayal_chat" in entry for entry in logs.output))

    @patch("AIModel.views._get_client", side_effect=EnvironmentError("ANTHROPIC_API_KEY 未設定"))
    def test_missing_anthropic_api_key_returns_503(self, _mock_get_client):
        response = self._post({"message": "hi"})
        self.assertEqual(response.status_code, 503)

    @patch("AIModel.views._get_client")
    def test_valid_message_returns_200(self, mock_get_client):
        mock_get_client.return_value = _mock_chat_client("哈囉")

        response = self._post({"message": "hi", "tribe": "tayal"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["message"], "哈囉")


class ReviewTayalChatViewTest(TestCase):
    """review_tayal_chat 的請求驗證與例外處理，同 TayalChatViewTest。"""

    def setUp(self):
        self.client_http = Client()
        cache.clear()

    def _post(self, payload):
        return self.client_http.post(
            '/AIModel/review_tayal_chat/',
            data=json.dumps(payload),
            content_type='application/json',
        )

    def test_invalid_tribe_returns_400(self):
        response = self._post({"message": "lokah su", "tribe": "not-a-real-tribe"})
        self.assertEqual(response.status_code, 400)

    @patch("AIModel.views.search_tayal_words_bulk", return_value={})
    @patch("AIModel.views._get_client")
    def test_upstream_failure_returns_generic_message_and_logs(self, mock_get_client, _mock_bulk):
        mock_client = MagicMock()
        mock_client.messages.create.side_effect = Exception("internal detail")
        mock_get_client.return_value = mock_client

        with self.assertLogs("AIModel.views", level="ERROR") as logs:
            response = self._post({"message": "lokah su"})

        self.assertEqual(response.status_code, 502)
        self.assertNotIn("internal detail", response.json()["detail"])
        self.assertTrue(any("review_tayal_chat" in entry for entry in logs.output))

    @patch("AIModel.views.search_tayal_words_bulk", return_value={})
    @patch("AIModel.views._get_client")
    def test_valid_message_returns_200(self, mock_get_client, _mock_bulk):
        mock_get_client.return_value = _mock_chat_client("補充說明")

        response = self._post({"message": "lokah su", "tribe": "tayal"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["translation"], "補充說明")


class RunTayalChatServiceTest(TestCase):
    """AIModel/services.py 的 run_tayal_chat：從 views.py 抽出來的 prompt 組裝／
    LLM 呼叫／讀書計畫 JSON 解析邏輯，這裡直接測函式本身（不透過 HTTP），
    確認抽取後行為跟原本內嵌在 view 裡時一致。"""

    def test_plain_reply_returns_message_only(self):
        client = _mock_chat_client("lokah su! 你的學習狀況不錯。")

        result = run_tayal_chat(client, "泰雅語", "你好", {"level": "beginner"})

        self.assertEqual(result, {"message": "lokah su! 你的學習狀況不錯。"})

    def test_valid_study_plan_json_returns_plan_and_confirmation_message(self):
        plan = {
            "type": "study_plan",
            "title": "一週讀書計畫",
            "events": [
                {"summary": "第一天", "start": "2026-01-02T10:00:00+08:00", "end": "2026-01-02T10:30:00+08:00"},
            ],
        }
        client = _mock_chat_client(json.dumps(plan))

        result = run_tayal_chat(client, "泰雅語", "幫我排一週讀書計畫", {})

        self.assertEqual(result["study_plan"], plan)
        self.assertIn("一週讀書計畫", result["message"])

    def test_study_plan_missing_required_event_fields_falls_back_to_message(self):
        # events 存在但缺 start/end，前端會直接用 event.start.split('T')，
        # 不完整就不該被當成有效計畫
        malformed = {"type": "study_plan", "title": "x", "events": [{"summary": "只有摘要"}]}
        raw = json.dumps(malformed)
        client = _mock_chat_client(raw)

        result = run_tayal_chat(client, "泰雅語", "排計畫", {})

        self.assertNotIn("study_plan", result)
        self.assertEqual(result["message"], raw)

    def test_non_json_reply_falls_back_to_message(self):
        client = _mock_chat_client("{ this is not valid json")

        result = run_tayal_chat(client, "泰雅語", "你好", {})

        self.assertEqual(result, {"message": "{ this is not valid json"})

    def test_request_uses_native_anthropic_shape(self):
        """system 走 system= 參數，messages 只放 user，沒有 role=system。"""
        client = _mock_chat_client("哈囉")

        run_tayal_chat(client, "泰雅語", "你好", {})

        _, kwargs = client.messages.create.call_args
        self.assertIn("泰雅語", kwargs["system"])
        self.assertEqual(kwargs["messages"], [{"role": "user", "content": "你好"}])
        self.assertEqual(kwargs["max_tokens"], 4096)
        self.assertNotIn("temperature", kwargs)


class RunReviewTayalChatServiceTest(TestCase):
    """AIModel/services.py 的 run_review_tayal_chat：確認回傳形狀與 relevant_words
    原樣帶出（不重新查詢/不遺漏欄位）。"""

    def test_returns_expected_shape(self):
        client = _mock_chat_client("補充說明文字")
        relevant_words = [{"tayal": "lokah", "audio": "f1", "chinese": "加油"}]

        result = run_review_tayal_chat(client, "泰雅語", "lokah su", relevant_words)

        self.assertEqual(result, {
            "original": "lokah su",
            "words": relevant_words,
            "translation": "補充說明文字",
            "image": None,
        })


class AssistantKillSwitchTest(TestCase):
    """AI 助手總開關（FeatureFlag ai_assistant_enabled）：關閉時兩支端點都回 403，
    而且完全不碰 LLM client；沒有旗標紀錄或開啟時維持原本行為。"""

    ENDPOINTS = ('/AIModel/tayal_chat/', '/AIModel/review_tayal_chat/')

    def setUp(self):
        self.client_http = Client()
        cache.clear()

    def _post(self, url):
        return self.client_http.post(
            url, data=json.dumps({"message": "hi", "tribe": "tayal"}), content_type='application/json',
        )

    @patch("AIModel.views._get_client")
    def test_disabled_flag_returns_403_without_calling_llm(self, mock_get_client):
        from adminapi.models import FeatureFlag
        FeatureFlag.objects.create(key="ai_assistant_enabled", label="AI 助手", enabled=False)

        for url in self.ENDPOINTS:
            response = self._post(url)
            self.assertEqual(response.status_code, 403, url)
            self.assertIn("暫停服務", response.json()["detail"])
        mock_get_client.assert_not_called()

    @patch("AIModel.views._get_client")
    def test_disabled_response_carries_machine_readable_code(self, _mock_get_client):
        from adminapi.models import FeatureFlag
        FeatureFlag.objects.create(key="ai_assistant_enabled", label="AI 助手", enabled=False)

        self.assertEqual(self._post('/AIModel/tayal_chat/').json()["code"], "ai_assistant_disabled")

    @patch("AIModel.views._rate_limited_response")
    @patch("AIModel.views._get_client")
    def test_disabled_flag_does_not_consume_rate_limit(self, _mock_get_client, mock_rate_limited):
        from adminapi.models import FeatureFlag
        FeatureFlag.objects.create(key="ai_assistant_enabled", label="AI 助手", enabled=False)

        for url in self.ENDPOINTS:
            self._post(url)
        mock_rate_limited.assert_not_called()

    @override_settings(AUTH_DEV_BYPASS=False)
    @patch("AIModel.views._get_client")
    def test_unauthenticated_request_gets_401_before_flag_check(self, mock_get_client):
        from adminapi.models import FeatureFlag
        FeatureFlag.objects.create(key="ai_assistant_enabled", label="AI 助手", enabled=False)

        for url in self.ENDPOINTS:
            self.assertEqual(self._post(url).status_code, 401, url)
        mock_get_client.assert_not_called()

    @patch("AIModel.views._get_client")
    def test_enabled_flag_keeps_normal_behavior(self, mock_get_client):
        from adminapi.models import FeatureFlag
        FeatureFlag.objects.create(key="ai_assistant_enabled", label="AI 助手", enabled=True)
        mock_get_client.return_value = _mock_chat_client("哈囉")

        for url in self.ENDPOINTS:
            self.assertEqual(self._post(url).status_code, 200, url)

    @patch("AIModel.views._get_client")
    def test_missing_flag_row_is_treated_as_enabled(self, mock_get_client):
        mock_get_client.return_value = _mock_chat_client("哈囉")

        response = self._post('/AIModel/tayal_chat/')

        self.assertEqual(response.status_code, 200)
