from types import SimpleNamespace
from unittest.mock import patch, MagicMock

from django.core.cache import cache
from django.test import TestCase, Client
from django.test.utils import override_settings

from crawler.views import format_quiz_data_1, format_quiz_data_2
from crawler.dictionary_source import fetch_words_by_glosses
from adminapi.models import ExamScheduleCrawlStatus, ExamScheduleOverride


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

    @patch('crawler.views.requests.get')
    def test_source_key_present_for_tacp_and_ntnu_items(self, mock_get):
        # source_key 是 adminapi/crawler_sync.py 拿來去重的鍵，格式要能區分
        # 兩個資料來源（tacp:<id> / ntnu-abst:<url>），不能兩邊撞在一起。
        def fake_get(url, headers=None, timeout=None):
            resp = MagicMock()
            resp.status_code = 200
            if "tacp.gov.tw" in url:
                resp.json.return_value = {"data": [
                    {"id": 999, "category_id": 1, "title": "測試活動", "images": []},
                ]}
            else:
                resp.text = (
                    '<html><body><div class="pnlArticles"><ul>'
                    '<li><small>115年8月1日</small><a href="x.html">測試考試新聞</a></li>'
                    '</ul></div></body></html>'
                )
            return resp

        mock_get.side_effect = fake_get

        response = self.client.get('/crawler/news/')
        data = response.json()

        tacp_item = next(i for i in data if i['isExam'] == 'F')
        exam_item = next(i for i in data if i['isExam'] == 'T')
        self.assertEqual(tacp_item['source_key'], 'tacp:999')
        self.assertEqual(exam_item['source_key'], 'ntnu-abst:https://exam.sce.ntnu.edu.tw/abst/x.html')

    @patch('crawler.views.requests.get')
    def test_javascript_href_in_exam_news_is_rejected(self, mock_get):
        # 上游 HTML 若被竄改成危險 scheme 的 href，detail/source_key 都必須
        # 是 None，不能把 javascript: 網址存進任何後續會被渲染成 <a href>
        # 的地方（見 _safe_external_url 的說明）。
        def fake_get(url, headers=None, timeout=None):
            resp = MagicMock()
            resp.status_code = 200
            if "tacp.gov.tw" in url:
                resp.json.return_value = {"data": []}
            else:
                resp.text = (
                    '<html><body><div class="pnlArticles"><ul>'
                    '<li><small>115年8月1日</small><a href="javascript:alert(1)">壞連結</a></li>'
                    '</ul></div></body></html>'
                )
            return resp

        mock_get.side_effect = fake_get

        response = self.client.get('/crawler/news/')
        data = response.json()

        exam_item = next(i for i in data if i['isExam'] == 'T')
        self.assertIsNone(exam_item['detail'])
        self.assertIsNone(exam_item['source_key'])

    @patch('crawler.views.requests.get')
    def test_force_refresh_bypasses_both_cache_layers(self, mock_get):
        # get_news_data 底下疊了兩層快取（自己的 NEWS_CACHE_KEY，以及跟考試
        # 時程共用的 EXAM_SITE_HTML_CACHE_KEY）；force_refresh 必須連共用的
        # HTML 快取也一起略過，否則「看起來重爬、其實還是吃 15 分鐘前的
        # 內容」——同一個坑 get_exam_schedule_data 已經踩過一次。
        from crawler.views import get_news_data

        def fake_get(url, headers=None, timeout=None):
            resp = MagicMock()
            resp.status_code = 200
            if "tacp.gov.tw" in url:
                resp.json.return_value = {"data": []}
            else:
                resp.text = "<html></html>"
            return resp

        mock_get.side_effect = fake_get

        get_news_data()  # 第一次：填滿兩層快取
        self.assertEqual(mock_get.call_count, 2)  # tacp + exam html 各一次

        get_news_data()  # 快取命中，不應該再打外部網站
        self.assertEqual(mock_get.call_count, 2)

        get_news_data(force_refresh=True)  # 強制重爬，兩層快取都要略過
        self.assertEqual(mock_get.call_count, 4)


# 官網（exam.sce.ntnu.edu.tw/abst/）日程表頁面結構的精簡版，只留下解析邏輯真正
# 依賴的部分：排除 news-tab 的第一個梯次分頁按鈕（取得梯次標題），以及該分頁
# 底下 table 的其中兩列（期程名稱 + 帶 dates= 參數的 Google 行事曆連結）。
FAKE_EXAM_SCHEDULE_HTML = """
<html><body>
<ul class="nav nav-tabs">
  <li><button class="nav-link active" id="news-tab">最新消息</button></li>
  <li><button class="nav-link" id="0-tab">115年度第1次原住民族語言能力認證測驗日程表</button></li>
</ul>
<div class="tab-pane" id="news-pane"></div>
<div class="tab-pane" id="0-pane">
  <table><tbody>
    <tr>
      <td><span class="fw-bold">報名日期</span></td>
      <td><a href="https://www.google.com/calendar/event?action=TEMPLATE&text=x&dates=20260121T100000/20260226T235900">115年1月21日(三) ~ 115年2月26日(四)</a></td>
    </tr>
    <tr>
      <td><span class="fw-bold">測驗日期</span></td>
      <td><a href="https://www.google.com/calendar/event?action=TEMPLATE&text=x&dates=20260418T000000/20260418T000000">115年4月18日(六)</a></td>
    </tr>
  </tbody></table>
</div>
</body></html>
"""


class GetExamScheduleTest(TestCase):
    """族語認證考試時程：爬官網日程表取代前端原本寫死的 examSchedule 假資料。"""

    def setUp(self):
        self.client = Client()
        cache.clear()

    @patch('crawler.views.is_ratelimited', return_value=True)
    def test_rate_limited_returns_429(self, _mock_limited):
        response = self.client.get('/crawler/exam_schedule/')
        self.assertEqual(response.status_code, 429)

    def test_does_not_require_login(self):
        with override_settings(AUTH_DEV_BYPASS=False):
            with patch('crawler.views.requests.get') as mock_get:
                mock_response = MagicMock()
                mock_response.status_code = 200
                mock_response.text = FAKE_EXAM_SCHEDULE_HTML
                mock_get.return_value = mock_response
                response = self.client.get('/crawler/exam_schedule/')
        self.assertEqual(response.status_code, 200)

    @patch('crawler.views.requests.get')
    def test_upstream_request_failure_returns_502(self, mock_get):
        import requests
        mock_get.side_effect = requests.exceptions.ConnectTimeout("upstream timed out")

        response = self.client.get('/crawler/exam_schedule/')

        self.assertEqual(response.status_code, 502)

    @patch('crawler.views.requests.get')
    def test_no_phases_parsed_returns_502_not_cached(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "<html><body>沒有日程表</body></html>"
        mock_get.return_value = mock_response

        response = self.client.get('/crawler/exam_schedule/')

        self.assertEqual(response.status_code, 502)
        from django.core.cache import cache as django_cache
        self.assertIsNone(django_cache.get('crawler_exam_schedule_data'))

    @patch('crawler.views.requests.get')
    def test_parses_session_name_and_phases_with_dates(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = FAKE_EXAM_SCHEDULE_HTML
        mock_get.return_value = mock_response

        response = self.client.get('/crawler/exam_schedule/')

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['session'], '115年度第1次原住民族語言能力認證測驗日程表')
        self.assertEqual(len(data['phases']), 2)

        registration = data['phases'][0]
        self.assertEqual(registration['phase'], '報名')
        self.assertEqual(registration['start_date'], '2026-01-21')
        self.assertEqual(registration['end_date'], '2026-02-26')

        exam_date = data['phases'][1]
        self.assertEqual(exam_date['phase'], '測驗')
        self.assertEqual(exam_date['start_date'], '2026-04-18')
        # 起訖同一天時 end_date 應為 None，不是重複同一天的日期字串
        self.assertIsNone(exam_date['end_date'])

    @patch('crawler.views.requests.get')
    def test_response_is_cached_across_requests(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = FAKE_EXAM_SCHEDULE_HTML
        mock_get.return_value = mock_response

        first = self.client.get('/crawler/exam_schedule/')
        second = self.client.get('/crawler/exam_schedule/')

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json(), second.json())
        mock_get.assert_called_once()


class ExamScheduleOverrideTest(TestCase):
    """後台人工覆寫套進公開端點的行為（見 crawler/views.py 的
    apply_exam_schedule_overrides／get_exam_schedule）。"""

    def setUp(self):
        self.client = Client()
        cache.clear()

    @patch('crawler.views.requests.get')
    def test_active_override_replaces_matching_phase(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = FAKE_EXAM_SCHEDULE_HTML
        mock_get.return_value = mock_response
        ExamScheduleOverride.objects.create(
            phase='報名', label='報名日期（人工修正）', start_date='2026-01-25', end_date='2026-03-01',
        )

        response = self.client.get('/crawler/exam_schedule/')
        phases = {p['phase']: p for p in response.json()['phases']}

        self.assertEqual(len(response.json()['phases']), 2)  # 取代既有筆數，不是額外多一筆
        self.assertEqual(phases['報名']['label'], '報名日期（人工修正）')
        self.assertEqual(phases['報名']['start_date'], '2026-01-25')
        self.assertEqual(phases['測驗']['start_date'], '2026-04-18')  # 沒被覆寫的維持爬蟲原值

    @patch('crawler.views.requests.get')
    def test_inactive_override_does_not_apply(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = FAKE_EXAM_SCHEDULE_HTML
        mock_get.return_value = mock_response
        ExamScheduleOverride.objects.create(
            phase='報名', start_date='2026-01-25', is_active=False,
        )

        response = self.client.get('/crawler/exam_schedule/')
        phases = {p['phase']: p for p in response.json()['phases']}
        self.assertEqual(phases['報名']['start_date'], '2026-01-21')  # 停用的覆寫不生效

    @patch('crawler.views.requests.get')
    def test_override_for_phase_not_scraped_is_appended(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = FAKE_EXAM_SCHEDULE_HTML
        mock_get.return_value = mock_response
        ExamScheduleOverride.objects.create(phase='證書', label='寄發合格證書', start_date='2026-06-01')

        response = self.client.get('/crawler/exam_schedule/')
        phases = {p['phase']: p for p in response.json()['phases']}
        self.assertEqual(len(response.json()['phases']), 3)
        self.assertEqual(phases['證書']['start_date'], '2026-06-01')

    @patch('crawler.views.requests.get')
    def test_crawl_failure_falls_back_to_override_only_instead_of_502(self, mock_get):
        import requests
        mock_get.side_effect = requests.exceptions.ConnectTimeout("upstream timed out")
        ExamScheduleOverride.objects.create(phase='報名', start_date='2026-01-25', end_date='2026-03-01')

        response = self.client.get('/crawler/exam_schedule/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['phases']), 1)
        self.assertEqual(response.json()['phases'][0]['phase'], '報名')

    @patch('crawler.views.requests.get')
    def test_crawl_failure_without_any_override_still_502s(self, mock_get):
        import requests
        mock_get.side_effect = requests.exceptions.ConnectTimeout("upstream timed out")

        response = self.client.get('/crawler/exam_schedule/')
        self.assertEqual(response.status_code, 502)

    @patch('crawler.views.requests.get')
    def test_successful_crawl_records_status(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = FAKE_EXAM_SCHEDULE_HTML
        mock_get.return_value = mock_response

        self.client.get('/crawler/exam_schedule/')

        status = ExamScheduleCrawlStatus.load()
        self.assertIsNotNone(status.last_success_at)
        self.assertEqual(status.consecutive_failures, 0)

    @patch('crawler.views.requests.get')
    def test_failed_crawl_increments_consecutive_failures(self, mock_get):
        import requests
        mock_get.side_effect = requests.exceptions.ConnectTimeout("upstream timed out")

        self.client.get('/crawler/exam_schedule/')
        self.client.get('/crawler/exam_schedule/')

        status = ExamScheduleCrawlStatus.load()
        self.assertEqual(status.consecutive_failures, 2)
        self.assertIn('上游請求失敗', status.last_failure_reason)

    @patch('crawler.views.requests.get')
    def test_cache_hit_does_not_touch_crawl_status(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = FAKE_EXAM_SCHEDULE_HTML
        mock_get.return_value = mock_response

        self.client.get('/crawler/exam_schedule/')
        status_after_first = ExamScheduleCrawlStatus.load()
        first_success_at = status_after_first.last_success_at

        self.client.get('/crawler/exam_schedule/')  # 第二次應該吃快取，不重新爬
        status_after_second = ExamScheduleCrawlStatus.load()
        self.assertEqual(status_after_second.last_success_at, first_success_at)
        mock_get.assert_called_once()


class FetchWordsByGlossesTest(TestCase):
    """dictionary_source.fetch_words_by_glosses 原本用原生 sqlite3.connect() 直接開檔，
    繞過 dictionary_db/connect.py 的連線池與 WAL/外鍵 PRAGMA 保護（跟 CrosswordPuzzle
    的 _get_words_from_db 一致的問題，那邊已經修過，這裡原本沒有跟上）。改成
    SessionLocal + text() 之後，這裡驗證：查詢有透過共用的 SessionLocal、
    正確依詞義篩選比對、同一詞義取第一筆、查無資料的族語回傳空字典。"""

    def _fake_rows(self, rows):
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = [
            SimpleNamespace(name=name, chinese_explanation=chinese) for name, chinese in rows
        ]
        return db

    @patch('crawler.dictionary_source.SessionLocal')
    def test_uses_shared_session_local(self, mock_session_local):
        db = self._fake_rows([("balay", "真的")])
        mock_session_local.return_value = db

        fetch_words_by_glosses("tayal", ["真的"])

        mock_session_local.assert_called_once()
        db.close.assert_called_once()

    @patch('crawler.dictionary_source.SessionLocal')
    def test_filters_to_requested_glosses_only(self, mock_session_local):
        mock_session_local.return_value = self._fake_rows([
            ("balay", "真的"), ("cyux", "在"), ("maku", "我的"),
        ])

        result = fetch_words_by_glosses("tayal", ["真的", "我的"])

        self.assertEqual(set(result.keys()), {"真的", "我的"})
        self.assertEqual(result["真的"], {"word": "balay", "chinese": "真的"})
        self.assertNotIn("在", result)

    @patch('crawler.dictionary_source.SessionLocal')
    def test_keeps_first_match_when_gloss_has_multiple_words(self, mock_session_local):
        mock_session_local.return_value = self._fake_rows([
            ("balay", "真的"), ("balay2", "真的"),
        ])

        result = fetch_words_by_glosses("tayal", ["真的"])

        self.assertEqual(result["真的"]["word"], "balay")

    def test_unknown_tribe_returns_empty_dict_without_querying(self):
        result = fetch_words_by_glosses("not-a-real-tribe", ["真的"])
        self.assertEqual(result, {})
