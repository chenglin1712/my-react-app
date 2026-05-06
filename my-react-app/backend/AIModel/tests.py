from django.test import TestCase
from unittest.mock import patch
import sqlite3
import os

from AIModel.views import search_tayal_words, search_tayal_words_bulk


class SearchTayalWordsTest(TestCase):
    """測試 search_tayal_words 的基本行為（不依賴真實資料庫）"""

    def _make_fake_row(self, name, chinese="test", audio_id="abc"):
        import json
        explanations = json.dumps([{"chineseExplanation": chinese}])
        audio_items = json.dumps([{"fileId": audio_id}])
        row = [None] * 16
        row[4] = name
        row[14] = explanations
        row[15] = audio_items
        return tuple(row)

    @patch("AIModel.views.sqlite3.connect")
    def test_existing_word_returns_list(self, mock_connect):
        fake_row = self._make_fake_row("cyux", chinese="happy", audio_id="file123")
        mock_cursor = mock_connect.return_value.cursor.return_value
        mock_cursor.fetchall.return_value = [fake_row]

        result = search_tayal_words("cyux", limit=1)

        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["tayal"], "cyux")
        self.assertEqual(result[0]["chinese"], "happy")

    @patch("AIModel.views.sqlite3.connect")
    def test_nonexistent_word_returns_empty(self, mock_connect):
        mock_cursor = mock_connect.return_value.cursor.return_value
        mock_cursor.fetchall.return_value = []

        result = search_tayal_words("not_exist", limit=1)

        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 0)

    @patch("AIModel.views.sqlite3.connect")
    def test_db_connection_failure_returns_empty(self, mock_connect):
        mock_connect.side_effect = Exception("DB connection failed")

        result = search_tayal_words("cyux", limit=1)

        self.assertEqual(result, [])

    @patch("AIModel.views.sqlite3.connect")
    def test_bulk_search_returns_dict(self, mock_connect):
        fake_row = self._make_fake_row("mami", chinese="mother", audio_id="file456")
        mock_cursor = mock_connect.return_value.cursor.return_value
        mock_cursor.fetchall.return_value = [fake_row]

        result = search_tayal_words_bulk(["mami"])

        self.assertIn("mami", result)
        self.assertEqual(result["mami"]["chinese"], "mother")

    def test_bulk_search_empty_input(self):
        result = search_tayal_words_bulk([])
        self.assertEqual(result, {})
