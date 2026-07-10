import json
from unittest.mock import patch, MagicMock

from django.core.cache import cache
from django.test import TestCase, Client
from django.test.utils import override_settings

from CrosswordPuzzle.views import _get_words_from_db


class GenerateCrosswordTest(TestCase):
    """generate_crossword 現在要求登入 + 限流（見 views.py 的稽核修正），
    這裡驗證這兩層防護，以及 tayal（走內建 word_list，不查資料庫）能正常出題。"""

    def setUp(self):
        self.client = Client()
        cache.clear()

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_requires_login_when_bypass_disabled(self):
        response = self.client.get('/CrosswordPuzzle/generate/?tribe=tayal')
        self.assertEqual(response.status_code, 401)

    @patch('CrosswordPuzzle.views.is_ratelimited', return_value=True)
    def test_rate_limited_returns_429(self, _mock_limited):
        response = self.client.get('/CrosswordPuzzle/generate/?tribe=tayal')
        self.assertEqual(response.status_code, 429)

    def test_generates_grid_for_tayal_fallback_word_list(self):
        response = self.client.get('/CrosswordPuzzle/generate/?tribe=tayal')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('grid_solution', data)
        self.assertIn('legend', data)
        self.assertIn('word_bank', data)
        self.assertGreater(len(data['word_bank']), 0)


class GetWordsFromDbTest(TestCase):
    """_get_words_from_db 的過濾邏輯：只留純英文字母、長度 4-10、有中文解釋的詞。"""

    def test_filters_non_alpha_short_and_unexplained_words(self):
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = [
            ("cyux", "高興"),     # 合格
            ("ab", "太短"),       # 長度不足，過濾
            ("qutux2", "含數字"),  # 非純英文字母，過濾
            ("balay", None),      # 沒有解釋，過濾
        ]
        with patch('CrosswordPuzzle.views.SessionLocal', return_value=mock_db):
            results, err = _get_words_from_db("some-tribe-id")

        self.assertIsNone(err)
        self.assertEqual(results, [["cyux", "高興"]])

    def test_db_error_returns_error_message(self):
        mock_db = MagicMock()
        mock_db.execute.side_effect = Exception("db is locked")
        with patch('CrosswordPuzzle.views.SessionLocal', return_value=mock_db):
            results, err = _get_words_from_db("some-tribe-id")

        self.assertEqual(results, [])
        self.assertIn("db is locked", err)


class SubmitAnsTest(TestCase):
    """submit_ans 的橫向/縱向逐字比對邏輯。"""

    def setUp(self):
        self.client = Client()
        cache.clear()

    def _payload(self, user_row):
        return {
            "user_answers": [list(user_row)],
            "crossword_solution": ["cyux"],
            "crossword_legend": [
                {
                    "number": 1, "clue": "高興", "direction": "across",
                    "length": 4, "start_col": 1, "start_row": 1, "word": "cyux",
                },
            ],
        }

    def test_scores_correct_answer(self):
        response = self.client.post(
            '/CrosswordPuzzle/submit/',
            data=json.dumps(self._payload("cyux")),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['correct_words_count'], 1)
        self.assertTrue(data['word_details'][0]['is_correct'])

    def test_scores_incorrect_answer(self):
        response = self.client.post(
            '/CrosswordPuzzle/submit/',
            data=json.dumps(self._payload("xxxx")),
            content_type='application/json',
        )
        data = response.json()
        self.assertEqual(data['correct_words_count'], 0)
        self.assertFalse(data['word_details'][0]['is_correct'])

    def test_get_method_not_allowed(self):
        response = self.client.get('/CrosswordPuzzle/submit/')
        self.assertEqual(response.status_code, 405)
