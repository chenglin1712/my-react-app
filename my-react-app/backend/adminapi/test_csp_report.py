"""稽核 BE5-04：CSP 違規回報收集端點。"""
import json
from unittest.mock import patch

from django.core.cache import cache
from django.test import Client, TestCase

URL = "/adminapi/public/csp-report/"


class CspReportTest(TestCase):
    def setUp(self):
        self.client = Client()
        cache.clear()

    def _post(self, payload, content_type="application/csp-report"):
        return self.client.post(URL, data=json.dumps(payload), content_type=content_type)

    def test_legacy_report_is_logged_without_query_string(self):
        report = {"csp-report": {
            "violated-directive": "img-src", "effective-directive": "img-src",
            "blocked-uri": "https://cdn.example.com/a.png?token=secret",
            "document-uri": "https://site.example/page?session=abc#frag",
        }}
        with self.assertLogs("csp_report", level="WARNING") as logs:
            response = self._post(report)
        self.assertEqual(response.status_code, 204)
        text = "\n".join(logs.output)
        self.assertIn("https://cdn.example.com/a.png", text)
        self.assertNotIn("secret", text)
        self.assertNotIn("session=abc", text)

    def test_reporting_api_format_is_accepted(self):
        report = [{"type": "csp-violation", "body": {
            "effectiveDirective": "media-src", "blockedURL": "https://x.example/a.webm", "documentURL": "https://site.example/",
        }}]
        with self.assertLogs("csp_report", level="WARNING") as logs:
            response = self._post(report, content_type="application/reports+json")
        self.assertEqual(response.status_code, 204)
        self.assertIn("media-src", "\n".join(logs.output))

    def test_garbage_gets_204_and_nothing_is_logged(self):
        response = self.client.post(URL, data="not json", content_type="application/csp-report")
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self._post({"hello": "world"}).status_code, 204)

    def test_control_characters_cannot_forge_log_lines(self):
        report = {"csp-report": {"effective-directive": "img-src\nFAKE LOG LINE", "blocked-uri": "inline\r\x1b[31m"}}
        with self.assertLogs("csp_report", level="WARNING") as logs:
            self._post(report)
        message = logs.records[0].getMessage()
        self.assertNotIn("\n", message)
        self.assertNotIn("\x1b", message)

    def test_only_post_is_allowed(self):
        self.assertEqual(self.client.get(URL).status_code, 405)

    def test_oversized_body_is_refused(self):
        response = self.client.post(URL, data="x" * (65 * 1024), content_type="application/csp-report")
        self.assertEqual(response.status_code, 413)

    @patch("adminapi._shared.is_ratelimited", return_value=True)
    def test_rate_limited(self, _mock):
        self.assertEqual(self._post({"csp-report": {"violated-directive": "img-src"}}).status_code, 429)
