import json
from unittest.mock import patch, MagicMock

from django.core.cache import cache
from django.test import TestCase, Client
from django.test.utils import override_settings

from CrosswordPuzzle.views import _get_words_from_db

# 5 個族語統一即時查辭典資料庫選字（原本只有泰雅語走另一套 CrosswordTayalWord
# 後台詞庫，使用者要求拿掉這個特例，見規劃文件「並行項目」章節）——這裡
# mock SessionLocal 回傳的原始查詢結果，模擬 _get_words_from_db() 篩選前的
# 資料庫列，讓 GenerateCrosswordTest 不必依賴真實 dictionary.db 內容。
_MOCK_DB_ROWS = [
    ("apah", "糯米飯"), ("bahat", "西瓜"), ("banan", "高粱"), ("bazing", "蛋"),
    ("kagang", "螃蟹"), ("llyung", "河流"), ("khelang", "客家人"),
]


class GenerateCrosswordTest(TestCase):
    """generate_crossword 現在要求登入 + 限流（見 views.py 的稽核修正），
    這裡驗證這兩層防護，以及 5 個族語（含泰雅語）統一走 _get_words_from_db
    即時查辭典資料庫都能正常出題。"""

    def setUp(self):
        self.client = Client()
        cache.clear()

    def _mock_db(self, rows):
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = rows
        return patch('CrosswordPuzzle.views.SessionLocal', return_value=mock_db)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_requires_login_when_bypass_disabled(self):
        response = self.client.get('/CrosswordPuzzle/generate/?tribe=tayal')
        self.assertEqual(response.status_code, 401)

    @patch('CrosswordPuzzle.views.is_ratelimited', return_value=True)
    def test_rate_limited_returns_429(self, _mock_limited):
        response = self.client.get('/CrosswordPuzzle/generate/?tribe=tayal')
        self.assertEqual(response.status_code, 429)

    def test_generates_grid_for_tayal_via_live_dictionary_query(self):
        # 回歸測試：泰雅語不再是特例，跟其餘 4 個族語共用同一套
        # _get_words_from_db 即時查辭典邏輯。
        with self._mock_db(_MOCK_DB_ROWS):
            response = self.client.get('/CrosswordPuzzle/generate/?tribe=tayal')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('grid_solution', data)
        self.assertIn('legend', data)
        self.assertIn('word_bank', data)
        self.assertGreater(len(data['word_bank']), 0)
        # debug_loops 是內部運算迴圈次數，純除錯用，正式環境 API 不該外露。
        self.assertNotIn('debug_loops', data['info'])

    def test_generates_grid_for_other_tribes_via_live_dictionary_query(self):
        with self._mock_db(_MOCK_DB_ROWS):
            response = self.client.get('/CrosswordPuzzle/generate/?tribe=amis')
        self.assertEqual(response.status_code, 200)
        self.assertGreater(len(response.json()['word_bank']), 0)

    def test_insufficient_word_pool_returns_500(self):
        # 只留 2 筆（低於 generate_crossword 要求的最少 5 筆）——泰雅語跟其他
        # 族語現在共用同一套「詞庫不足」降級行為，不是靜默生成殘缺的填字遊戲。
        with self._mock_db(_MOCK_DB_ROWS[:2]):
            response = self.client.get('/CrosswordPuzzle/generate/?tribe=tayal')
        self.assertEqual(response.status_code, 500)

    def test_unsupported_tribe_returns_400(self):
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

    def test_query_randomizes_and_bounds_the_candidate_pool(self):
        # 回歸測試：原本完全沒有 ORDER BY／LIMIT，永遠固定拿到資料庫回傳
        # 順序的前 limit 筆，每一局候選詞完全相同，且不管詞庫多大都整族語
        # 掃過一遍——這裡驗證第一次查詢真的帶了 ORDER BY RANDOM() 與一個
        # 用參數傳入（不是字串拼接）的上限。
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = [
            ("cyux", "高興"), ("balay", "真的"), ("mita", "看"),
            ("kmal", "說"), ("pusa", "去"),
        ]
        with patch('CrosswordPuzzle.views.SessionLocal', return_value=mock_db):
            results, err = _get_words_from_db("some-tribe-id", min_length=4, max_length=10, limit=3)

        self.assertIsNone(err)
        self.assertEqual(len(results), 3)
        # 5 筆候選裡有 5 筆合格，遠超過 limit=3，第一次隨機批次就該夠用，
        # 不需要退回全量查詢。
        self.assertEqual(mock_db.execute.call_count, 1)
        first_call_args, first_call_kwargs = mock_db.execute.call_args_list[0]
        sql_text = first_call_args[0].text
        self.assertIn("ORDER BY RANDOM()", sql_text)
        self.assertIn("LIMIT :oversample", sql_text)
        self.assertEqual(first_call_args[1]["oversample"], max(3 * 8, 200))

    def test_falls_back_to_full_query_when_random_batch_has_too_few_eligible_words(self):
        # 隨機批次（第一次查詢）刻意讓大部分候選都不合格（非純英文字母），
        # 驗證「隨機批次篩完不夠」不會被誤判成「詞庫真的不夠」——退回全量
        # 查詢後應該要能找滿 limit 筆，不是隨機批次沒抽好就少給。
        oversample_batch = [("qutux1", "一"), ("qutux2", "二"), ("cyux", "高興")]
        full_batch = [
            ("cyux", "高興"), ("balay", "真的"), ("mita", "看"),
            ("kmal", "說"), ("pusa", "去"),
        ]
        first_result = MagicMock()
        first_result.fetchall.return_value = oversample_batch
        second_result = MagicMock()
        second_result.fetchall.return_value = full_batch
        mock_db = MagicMock()
        mock_db.execute.side_effect = [first_result, second_result]

        with patch('CrosswordPuzzle.views.SessionLocal', return_value=mock_db):
            results, err = _get_words_from_db("some-tribe-id", min_length=4, max_length=10, limit=5)

        self.assertIsNone(err)
        self.assertEqual(len(results), 5)
        self.assertEqual(mock_db.execute.call_count, 2)
        # 退回查詢不該再帶隨機排序／上限——這是「整族語掃過一遍」的保底查詢。
        second_call_args = mock_db.execute.call_args_list[1][0]
        self.assertNotIn("RANDOM()", second_call_args[0].text)

    def test_tayal_and_other_tribes_use_the_same_query_path(self):
        # 泰雅語不再有專屬詞庫，跟其他族語共用同一支函式、同一套 SQL——
        # 只有傳入的 tribe_id 不同，驗證呼叫參數而非另外走一條路徑。
        mock_db = MagicMock()
        mock_db.execute.return_value.fetchall.return_value = [("cyux", "高興")]
        with patch('CrosswordPuzzle.views.SessionLocal', return_value=mock_db):
            _get_words_from_db("tayal-tribe-id", min_length=4, max_length=10, limit=3)
        params = mock_db.execute.call_args_list[0][0][1]
        self.assertEqual(params["tribe_id"], "tayal-tribe-id")


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
