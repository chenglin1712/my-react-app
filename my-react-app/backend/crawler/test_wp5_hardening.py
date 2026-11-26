"""WP-5（限流、部署與爬蟲）稽核項目的回歸測試：BE1-01／06／07、BE5-02／03／10／11、BE2b-09。"""
import os
from datetime import date, datetime, timezone as dt_timezone
from unittest.mock import MagicMock, patch

import requests
from django.core.cache import cache
from django.test import RequestFactory, SimpleTestCase, TestCase

from config.auth_flags import dev_bypass_exposure_problem
from crawler import exam_site


class OnlyGetIsAllowedTests(SimpleTestCase):
    def test_head_options_and_post_get_405_before_any_rate_limit_or_work(self):
        """稽核 BE1-01：限流只計 GET，其他方法若放行就能繞過限流與每日份數上限。"""
        from CrosswordPuzzle import views as crossword_views
        from crawler import views as crawler_views

        factory = RequestFactory()
        views = (
            crawler_views.get_quiz_data, crawler_views.get_situation_quiz_data,
            crawler_views.get_tayal_imformation, crawler_views.get_exam_schedule,
            crossword_views.generate_crossword,
        )
        for view in views:
            for method in ("head", "options", "post"):
                request = getattr(factory, method)("/x/")
                self.assertEqual(view(request).status_code, 405, f"{view.__name__} {method}")


class InvalidUtf8BodyTests(TestCase):
    def test_crossword_submit_with_non_utf8_body_is_400_not_500(self):
        from CrosswordPuzzle import views as crossword_views

        request = RequestFactory().post("/x/", data=b"\xff\xfe\xfa", content_type="application/json")
        with patch.object(crossword_views, "verify_firebase_token", return_value=({"uid": "u1"}, None)), \
                patch.object(crossword_views, "_rate_limited_response", return_value=None):
            response = crossword_views.submit_ans(request)
        self.assertEqual(response.status_code, 400)


class CrosswordConcurrencyTests(TestCase):
    def test_busy_server_answers_503_instead_of_queuing_another_cpu_loop(self):
        from CrosswordPuzzle import views as crossword_views

        request = RequestFactory().get("/x/?tribe=tayal")
        busy = MagicMock()
        busy.acquire.return_value = False
        words = [["alpha", "a"], ["bravo", "b"], ["carol", "c"], ["delta", "d"], ["eagle", "e"]]
        with patch.object(crossword_views, "verify_firebase_token", return_value=({"uid": "u1"}, None)), \
                patch.object(crossword_views, "_rate_limited_response", return_value=None), \
                patch.object(crossword_views, "_get_words_from_db", return_value=(words, None)), \
                patch.object(crossword_views, "_generation_slots", busy):
            response = crossword_views.generate_crossword(request)
        self.assertEqual(response.status_code, 503)


class ExamSiteFailureHandlingTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def test_a_failed_upstream_is_remembered_so_later_requests_do_not_hang_on_it(self):
        with patch("crawler.exam_site.requests.get", side_effect=requests.ConnectionError("down")) as get:
            for _ in range(3):
                with self.assertRaises(requests.RequestException):
                    exam_site._fetch_exam_site_html()
        self.assertEqual(get.call_count, 1)

    def test_skipped_fetch_is_not_recorded_as_a_new_crawl_failure(self):
        cache.set(exam_site.EXAM_SITE_FAILURE_CACHE_KEY, 1, 60)
        with patch("crawler.exam_site.requests.get") as get, \
                patch("crawler.exam_site.record_crawl_failure") as record:
            self.assertIsNone(exam_site.get_exam_schedule_data())
        get.assert_not_called()
        record.assert_not_called()

    def test_forced_refresh_ignores_the_failure_memory(self):
        cache.set(exam_site.EXAM_SITE_FAILURE_CACHE_KEY, 1, 60)
        response = MagicMock(text="<html></html>")
        with patch("crawler.exam_site.requests.get", return_value=response) as get:
            self.assertEqual(exam_site._fetch_exam_site_html(force_refresh=True), "<html></html>")
        get.assert_called_once()
        self.assertIsNone(cache.get(exam_site.EXAM_SITE_FAILURE_CACHE_KEY))

    def test_lock_is_released_after_a_failure(self):
        with patch("crawler.exam_site.requests.get", side_effect=requests.Timeout("slow")):
            with self.assertRaises(requests.RequestException):
                exam_site._fetch_exam_site_html()
        self.assertIsNone(cache.get(exam_site.EXAM_SITE_LOCK_KEY))

    def test_news_failure_is_remembered_too(self):
        with patch("crawler.exam_site._scrape_news", return_value=(None, "壞了")) as scrape:
            self.assertIsNone(exam_site.get_news_data())
            self.assertIsNone(exam_site.get_news_data())
        self.assertEqual(scrape.call_count, 1)

    def test_one_row_with_an_impossible_date_is_skipped_instead_of_failing_the_page(self):
        def row(label, dates):
            return (f'<tr><td><span class="fw-bold">{label}</span></td>'
                    f'<td><a href="https://calendar.example/?dates={dates}">加入</a></td></tr>')

        html = ('<div class="tab-pane"><table><tbody>'
                + row("報名日期", "20261340T000000/20261341T000000")
                + row("測驗日期", "20261201T090000/20261201T120000")
                + "</tbody></table></div>")
        with patch("crawler.exam_site._fetch_exam_site_html", return_value=html):
            data, error = exam_site._scrape_exam_schedule()
        self.assertIsNone(error)
        self.assertEqual([p["label"] for p in data["phases"]], ["測驗日期"])


class ConcurrentFetchTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def test_a_request_that_loses_the_lock_waits_for_the_winners_html_instead_of_failing(self):
        cache.set(exam_site.EXAM_SITE_LOCK_KEY, 1, 30)   # 別的請求正在抓

        def winner_finishes(_seconds):
            cache.set(exam_site.EXAM_SITE_HTML_CACHE_KEY, "<html>ok</html>", 60)

        with patch("crawler.exam_site.time.sleep", side_effect=winner_finishes), \
                patch("crawler.exam_site.requests.get") as get:
            self.assertEqual(exam_site._fetch_exam_site_html(), "<html>ok</html>")
        get.assert_not_called()


class AnalyticsTaipeiDayTests(SimpleTestCase):
    def test_taipei_midnight_is_8am_utc_the_day_before(self):
        from adminapi.analytics_service import _created_between

        bounds = _created_between(date(2026, 11, 25), date(2026, 11, 25))
        self.assertEqual(bounds["created_at__gte"].astimezone(dt_timezone.utc), datetime(2026, 11, 24, 16, tzinfo=dt_timezone.utc))
        self.assertEqual(bounds["created_at__lt"].astimezone(dt_timezone.utc), datetime(2026, 11, 25, 16, tzinfo=dt_timezone.utc))

    def test_join_date_near_midnight_lands_on_the_taipei_day(self):
        from adminapi.analytics_service import _join_date_to_local_date

        self.assertEqual(_join_date_to_local_date("2026-11-24T17:00:00.000Z"), date(2026, 11, 25))

    def test_extreme_end_date_does_not_overflow(self):
        from adminapi.analytics_service import _created_between

        _created_between(date(9999, 12, 1), date(9999, 12, 31))


class DevBypassBindTests(SimpleTestCase):
    LOCAL = ["localhost", "127.0.0.1"]

    def test_glued_short_bind_option_is_checked(self):
        self.assertIsNotNone(dev_bypass_exposure_problem(self.LOCAL, ["gunicorn", "-b0.0.0.0:8000", "core.wsgi:application"]))
        self.assertIsNone(dev_bypass_exposure_problem(self.LOCAL, ["gunicorn", "-b127.0.0.1:8000", "core.wsgi:application"]))

    def test_gunicorn_without_bind_but_with_port_env_listens_on_all_interfaces(self):
        with patch.dict(os.environ, {"PORT": "8000"}):
            self.assertIsNotNone(dev_bypass_exposure_problem(self.LOCAL, ["gunicorn", "core.wsgi:application"]))

    def test_gunicorn_with_a_config_file_cannot_be_proven_loopback(self):
        env = {k: v for k, v in os.environ.items() if k != "PORT"}
        with patch.dict(os.environ, env, clear=True):
            self.assertIsNotNone(dev_bypass_exposure_problem(self.LOCAL, ["gunicorn", "-c", "gunicorn.conf.py", "core.wsgi:application"]))

    def test_python_dash_m_gunicorn_is_recognised(self):
        argv = ["/venv/lib/site-packages/gunicorn/__main__.py", "core.wsgi:application"]
        with patch.dict(os.environ, {"PORT": "8000"}):
            self.assertIsNotNone(dev_bypass_exposure_problem(self.LOCAL, argv))

    def test_an_auto_loaded_gunicorn_conf_py_cannot_be_proven_loopback(self):
        env = {k: v for k, v in os.environ.items() if k != "PORT"}
        with patch.dict(os.environ, env, clear=True), patch("config.auth_flags.os.path.exists", return_value=True):
            self.assertIsNotNone(dev_bypass_exposure_problem(self.LOCAL, ["gunicorn", "core.wsgi:application"]))

    def test_local_dev_runners_are_not_affected(self):
        """本機開發用 uvicorn（run.py）或 manage.py runserver 啟動，不能被這項檢查擋掉。"""
        self.assertIsNone(dev_bypass_exposure_problem(self.LOCAL, ["run.py"]))
        self.assertIsNone(dev_bypass_exposure_problem(self.LOCAL, ["manage.py", "runserver"]))

    def test_plain_gunicorn_without_port_defaults_to_loopback(self):
        env = {k: v for k, v in os.environ.items() if k != "PORT"}
        with patch.dict(os.environ, env, clear=True):
            self.assertIsNone(dev_bypass_exposure_problem(self.LOCAL, ["gunicorn", "core.wsgi:application"]))
