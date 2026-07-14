from unittest.mock import patch, MagicMock

from django.core.cache import cache
from django.test import TestCase, Client
from django.test.utils import override_settings

from crawler.views import format_quiz_data_1, format_quiz_data_2


class GetQuizDataTest(TestCase):
    """get_quiz_data 現在要求登入 + 限流，且對外部 API 呼叫補上了逾時
    （見 views.py 的稽核修正）。"""

    def setUp(self):
        self.client = Client()
        cache.clear()

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_requires_login_when_bypass_disabled(self):
        response = self.client.get('/crawler/?tribe=tayal&level=1')
        self.assertEqual(response.status_code, 401)

    @patch('crawler.views.is_ratelimited', return_value=True)
    def test_rate_limited_returns_429(self, _mock_limited):
        response = self.client.get('/crawler/?tribe=tayal&level=1')
        self.assertEqual(response.status_code, 429)

    def test_unsupported_tribe_returns_400(self):
        response = self.client.get('/crawler/?tribe=not_a_tribe&level=1')
        self.assertEqual(response.status_code, 400)
        self.assertIn('不支援的族語', response.json()['detail'])

    def test_unsupported_level_returns_400(self):
        response = self.client.get('/crawler/?tribe=tayal&level=9')
        self.assertEqual(response.status_code, 400)
        self.assertIn('不支援的等級', response.json()['detail'])

    def test_level_3_uses_local_bank_not_external_api(self):
        # TRIBE_CONFIG 在 module import 時就把 tayal_bank.build_matching_test 的函式物件
        # 綁進字典了，patch 模組屬性不會影響已經綁定的參照，所以這裡直接斷言「不打外部
        # API」這個真正要驗證的行為，而不去 mock 本地題庫函式本身。
        with patch('crawler.views.requests.get') as mock_get:
            response = self.client.get('/crawler/?tribe=tayal&level=3')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('parts', data)
        mock_get.assert_not_called()

    @patch('crawler.views.requests.get')
    def test_level_1_calls_external_api_with_timeout(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": {
                "display_dialect_name": "泰雅語",
                "part1": {
                    "title": "第一部分", "intro": "",
                    "questions": [{"question_ab": "cyux", "question_ch": "高興", "audio": "", "image": ""}],
                    "answers": [True],
                },
            }
        }
        mock_get.return_value = mock_response

        response = self.client.get('/crawler/?tribe=tayal&level=1')

        self.assertEqual(response.status_code, 200)
        _, kwargs = mock_get.call_args
        self.assertEqual(kwargs.get('timeout'), 10)
        data = response.json()
        self.assertEqual(data['parts'][0]['questions'][0]['question_ab'], 'cyux')

    @patch('crawler.views.requests.get')
    def test_external_api_failure_returns_500(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_get.return_value = mock_response

        response = self.client.get('/crawler/?tribe=tayal&level=1')
        self.assertEqual(response.status_code, 500)

    @patch('crawler.views.requests.get')
    def test_upstream_timeout_returns_502_not_500(self, mock_get):
        # 原本 requests.get 完全沒包 try/except，逾時／連線失敗的例外會一路往外拋，
        # 被 Django 預設的 500 處理接住。
        import requests
        mock_get.side_effect = requests.exceptions.ConnectTimeout("upstream timed out")

        response = self.client.get('/crawler/?tribe=tayal&level=1')

        self.assertEqual(response.status_code, 502)

    @patch('crawler.views.requests.get')
    def test_level_1_2_response_is_cached_across_requests(self, mock_get):
        # start_exam 只依 dialect_id/level 決定內容，同一組合快取後第二次呼叫
        # 不該再打一次第三方 API（見 views.py 的稽核修正）。
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": {
                "display_dialect_name": "泰雅語",
                "part1": {
                    "title": "t", "intro": "",
                    "questions": [{"question_ab": "cyux", "question_ch": "高興", "audio": "", "image": ""}],
                    "answers": [True],
                },
            }
        }
        mock_get.return_value = mock_response

        first = self.client.get('/crawler/?tribe=tayal&level=1')
        second = self.client.get('/crawler/?tribe=tayal&level=1')

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json(), second.json())
        mock_get.assert_called_once()


class FormatQuizDataTest(TestCase):
    def test_format_quiz_data_1_maps_questions_and_answers(self):
        raw = {
            "data": {
                "display_dialect_name": "泰雅語",
                "part1": {
                    "title": "t", "intro": "i",
                    "questions": [{"question_ab": "cyux", "question_ch": "高興", "audio": "a.mp3", "image": None}],
                    "answers": [True],
                },
            }
        }
        result = format_quiz_data_1(raw)
        self.assertEqual(result['chapter_name'], '泰雅語')
        self.assertEqual(result['parts'][0]['type'], 'true_false')
        self.assertEqual(result['parts'][0]['questions'][0]['answer'], True)

    def test_format_quiz_data_2_handles_missing_part2(self):
        raw = {"data": {"display_dialect_name": "泰雅語"}}
        result = format_quiz_data_2(raw)
        self.assertEqual(result['parts'], [])

    def test_format_quiz_data_2_maps_choice_questions(self):
        raw = {
            "data": {
                "display_dialect_name": "泰雅語",
                "part2": {
                    "questions": [{
                        "question_ab": "balay", "question_ch": "真的", "audio": "",
                        "imageA": "a.png", "imageB": "b.png", "imageC": "c.png",
                    }],
                    "answers": ["A"],
                },
            }
        }
        result = format_quiz_data_2(raw)
        self.assertEqual(result['parts'][0]['type'], 'choice')
        self.assertEqual(result['parts'][0]['questions'][0]['answer'], 'A')


class GetTayalImformationTest(TestCase):
    """首頁新聞端點：維持公開（不要求登入），但要有限流。"""

    def setUp(self):
        self.client = Client()
        cache.clear()

    @patch('crawler.views.is_ratelimited', return_value=True)
    def test_rate_limited_returns_429(self, _mock_limited):
        response = self.client.get('/crawler/news/')
        self.assertEqual(response.status_code, 429)

    def test_does_not_require_login(self):
        with override_settings(AUTH_DEV_BYPASS=False):
            with patch('crawler.views.requests.get') as mock_get:
                mock_response = MagicMock()
                mock_response.status_code = 200
                mock_response.json.return_value = {"data": []}
                mock_response.text = "<html></html>"
                mock_get.return_value = mock_response
                response = self.client.get('/crawler/news/')
        self.assertEqual(response.status_code, 200)

    @patch('crawler.views.BeautifulSoup')
    @patch('crawler.views.requests.get')
    def test_both_sources_failing_returns_502_not_cached_empty_200(self, mock_get, mock_soup):
        # 原本兩個來源都用 bare except 吞掉例外、只記 log，最後一律回 200，呼叫端
        # 沒辦法分辨「今天真的沒新聞」跟「爬蟲已經壞掉」。兩個來源都真的丟例外時
        # 應該回 502，且不該把這次的空結果快取下來（否則要等 TTL 過期才會重新
        # 嘗試，502 狀況會被快取的空結果多拖 15 分鐘）。
        mock_get.side_effect = Exception("tacp/exam 皆連線失敗")

        response = self.client.get('/crawler/news/')

        self.assertEqual(response.status_code, 502)
        from django.core.cache import cache as django_cache
        self.assertIsNone(django_cache.get('crawler_news_data'))

    @patch('crawler.views.requests.get')
    def test_partial_success_still_returns_200(self, mock_get):
        # tacp 來源成功、exam 來源（BeautifulSoup 解析）就算沒抓到任何項目也不算
        # 「失敗」，只要有一個來源正常跑完，就仍視為部分成功。
        def fake_get(url, headers=None, timeout=None):
            resp = MagicMock()
            if "tacp.gov.tw" in url:
                resp.status_code = 200
                resp.json.return_value = {"data": []}
            else:
                resp.status_code = 200
                resp.text = "<html></html>"
            return resp

        mock_get.side_effect = fake_get

        response = self.client.get('/crawler/news/')

        self.assertEqual(response.status_code, 200)
