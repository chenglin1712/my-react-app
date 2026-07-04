from django.test import TestCase
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
