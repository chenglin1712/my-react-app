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
