import json
from unittest.mock import patch, MagicMock

from django.core.cache import cache
from django.test import TestCase, Client
from django.test.utils import override_settings

from adminapi.models import CrosswordTayalWord
from CrosswordPuzzle.views import _get_words_from_db


# 泰雅語填字遊戲改讀 CrosswordTayalWord（見規劃文件「並行項目」章節），這裡
# 種幾筆長度落在預設詞長範圍（4-10）內的詞，讓依賴「泰雅語能正常出題」的
# 測試不必逐一各自建資料。
_SAMPLE_TAYAL_WORDS = [
    ("apah", "糯米飯"), ("bahat", "西瓜"), ("banan", "高粱"), ("bazing", "蛋"),
    ("kagang", "螃蟹"), ("llyung", "河流"), ("khelang", "客家人"),
]


class GenerateCrosswordTest(TestCase):
    """generate_crossword 現在要求登入 + 限流（見 views.py 的稽核修正），
    這裡驗證這兩層防護，以及 tayal（讀 CrosswordTayalWord，不查辭典資料庫）
    能正常出題。"""

    def setUp(self):
        self.client = Client()
        cache.clear()
        for index, (word, meaning) in enumerate(_SAMPLE_TAYAL_WORDS):
            CrosswordTayalWord.objects.create(word=word, meaning=meaning, sort_order=index)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_requires_login_when_bypass_disabled(self):
        response = self.client.get('/CrosswordPuzzle/generate/?tribe=tayal')
        self.assertEqual(response.status_code, 401)

    @patch('CrosswordPuzzle.views.is_ratelimited', return_value=True)
    def test_rate_limited_returns_429(self, _mock_limited):
        response = self.client.get('/CrosswordPuzzle/generate/?tribe=tayal')
        self.assertEqual(response.status_code, 429)

    def test_generates_grid_for_tayal_from_db_word_list(self):
        response = self.client.get('/CrosswordPuzzle/generate/?tribe=tayal')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('grid_solution', data)
        self.assertIn('legend', data)
        self.assertIn('word_bank', data)
        self.assertGreater(len(data['word_bank']), 0)
        # debug_loops 是內部運算迴圈次數，純除錯用，正式環境 API 不該外露。
        self.assertNotIn('debug_loops', data['info'])

    def test_tayal_word_list_too_small_returns_500(self):
        # 只留 2 筆（低於 generate_crossword 要求的最少 5 筆），確認改讀資料庫
        # 之後，詞庫不足的降級行為跟其餘族語（_get_words_from_db 分支）一致，
        # 不是靜默生成殘缺的填字遊戲。
        CrosswordTayalWord.objects.exclude(word__in=["apah", "bahat"]).delete()
        response = self.client.get('/CrosswordPuzzle/generate/?tribe=tayal')
        self.assertEqual(response.status_code, 500)

    def test_unsupported_tribe_returns_400_instead_of_silent_tayal_fallback(self):
        # 回歸測試：修正前，任何不在 _ALL_TRIBE_IDS 裡的族語值都會落到跟 tayal
        # 一模一樣的 else 分支，靜默回傳泰雅語填字遊戲而非報錯——使用者以為
        # 自己玩的是別的族語，實際上悄悄拿到錯部落的題目。
        response = self.client.get('/CrosswordPuzzle/generate/?tribe=not-a-real-tribe')
        self.assertEqual(response.status_code, 400)


class GetWordsFromDbTest(TestCase):
    """_get_words_from_db 的過濾邏輯：只留純英文字母、長度落在指定範圍、
    有中文解釋的詞。"""

    def test_filters_non_alpha_short_and_unexplained_words(self):
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = [
            ("cyux", "高興"),     # 合格
            ("ab", "太短"),       # 長度不足，過濾
            ("qutux2", "含數字"),  # 非純英文字母，過濾
            ("balay", None),      # 沒有解釋，過濾
        ]
        with patch('CrosswordPuzzle.views.SessionLocal', return_value=mock_db):
            results, err = _get_words_from_db("some-tribe-id", min_length=4, max_length=10, limit=30)

        self.assertIsNone(err)
        self.assertEqual(results, [["cyux", "高興"]])

    def test_db_error_returns_error_flag_without_leaking_exception_message(self):
        # err 現在只是「有沒有失敗」的旗標，不再是原始例外訊息本身——原本直接把
        # str(e) 一路傳到 generate_crossword 的 JSON 回應裡，會把資料庫查詢細節
        # 洩漏給前端呼叫端。
        mock_db = MagicMock()
        mock_db.execute.side_effect = Exception("db is locked")
        with patch('CrosswordPuzzle.views.SessionLocal', return_value=mock_db):
            results, err = _get_words_from_db("some-tribe-id", min_length=4, max_length=10, limit=30)

        self.assertEqual(results, [])
        self.assertTrue(err)

    def test_respects_configurable_length_bounds(self):
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = [
            ("cyux", "高興"), ("balay", "真的"), ("qutuxbaga", "一個東西"),
        ]
        with patch('CrosswordPuzzle.views.SessionLocal', return_value=mock_db):
            results, err = _get_words_from_db("some-tribe-id", min_length=5, max_length=6, limit=30)

        self.assertIsNone(err)
        self.assertEqual(results, [["balay", "真的"]])


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

    def test_malformed_json_returns_400_not_html_500(self):
        # 原本沒驗證請求結構，畸形請求會讓例外一路往外拋、被 Django 預設的 500
        # 處理接住（正式環境回一頁 HTML），跟這個 API 統一回 JSON 的約定不一致。
        response = self.client.post(
            '/CrosswordPuzzle/submit/',
            data="not valid json",
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)

    def test_missing_required_field_returns_400(self):
        payload = self._payload("cyux")
        del payload["crossword_legend"]
        response = self.client.post(
            '/CrosswordPuzzle/submit/',
            data=json.dumps(payload),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)

    def test_wrong_field_type_returns_400(self):
        payload = self._payload("cyux")
        payload["crossword_solution"] = "not-a-list"
        response = self.client.post(
            '/CrosswordPuzzle/submit/',
            data=json.dumps(payload),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)

    @patch('CrosswordPuzzle.views.is_ratelimited', return_value=True)
    def test_rate_limited_returns_429(self, _mock_limited):
        response = self.client.post(
            '/CrosswordPuzzle/submit/',
            data=json.dumps(self._payload("cyux")),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 429)

    # 稽核修正：length/start_col/start_row 原本只是普通 IntegerField，沒有下限，
    # 0 或負數會讓判分整個失準（length<=0 時 for i in range(word_length) 迴圈
    # 不執行，預設 True 的 is_correct 永遠不會被推翻；start_row/start_col 為 0
    # 則會讓 start_row - 1 算出 -1，繞成負索引比對到陣列最後一列/欄），
    # 現在應該在序列化驗證階段就被擋成 400。
    def test_rejects_non_positive_length(self):
        payload = self._payload("")
        payload["crossword_legend"][0]["length"] = 0
        response = self.client.post(
            '/CrosswordPuzzle/submit/',
            data=json.dumps(payload),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)

    def test_rejects_non_positive_start_row(self):
        payload = self._payload("cyux")
        payload["crossword_legend"][0]["start_row"] = 0
        response = self.client.post(
            '/CrosswordPuzzle/submit/',
            data=json.dumps(payload),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)

    def test_rejects_non_positive_start_col(self):
        payload = self._payload("cyux")
        payload["crossword_legend"][0]["start_col"] = 0
        response = self.client.post(
            '/CrosswordPuzzle/submit/',
            data=json.dumps(payload),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
