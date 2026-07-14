import json

from django.core.cache import cache
from django.test import TestCase, Client
from unittest.mock import patch, MagicMock

from AIModel.views import search_tayal_words, search_tayal_words_bulk


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
    mock_response = MagicMock()
    mock_response.choices = [MagicMock(message=MagicMock(content=reply_text))]
    mock_client.chat.completions.create.return_value = mock_response
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
        mock_client.chat.completions.create.side_effect = Exception("internal api key xyz")
        mock_get_client.return_value = mock_client

        with self.assertLogs("AIModel.views", level="ERROR") as logs:
            response = self._post({"message": "hi"})

        self.assertEqual(response.status_code, 502)
        self.assertNotIn("internal api key xyz", response.json()["detail"])
        self.assertTrue(any("tayal_chat" in entry for entry in logs.output))

    @patch("AIModel.views._get_client", side_effect=EnvironmentError("GITHUB_TOKEN 未設定"))
    def test_missing_github_token_returns_503(self, _mock_get_client):
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
        mock_client.chat.completions.create.side_effect = Exception("internal detail")
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
