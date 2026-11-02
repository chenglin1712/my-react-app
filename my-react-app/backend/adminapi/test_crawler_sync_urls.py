"""crawler_sync 寫入資料庫前的網址檢查（稽核 FE-3）。

crawler/exam_site.py 的 _safe_external_url 已在來源端擋掉非 http(s)；這裡測的是
sink 端 build_announcement_defaults 自己的檢查，不依賴上游，所以直接餵
「上游被入侵」會給的資料。純函式測試，不碰資料庫。
"""
from django.test import SimpleTestCase

from .crawler_sync import build_announcement_defaults


def _defaults(**overrides):
    item = {"title": "標題", "source_key": "tacp:1", "isExam": "F"}
    item.update(overrides)
    return build_announcement_defaults(item)


class CrawlerSyncUrlGuardTests(SimpleTestCase):
    def test_https_link_and_image_pass_through(self):
        result = _defaults(
            detail="https://www.tacp.gov.tw/news/1/2",
            image="https://www.tacp.gov.tw/upload/a.jpg",
        )
        self.assertEqual(result["link_url"], "https://www.tacp.gov.tw/news/1/2")
        self.assertEqual(result["cover_image_url"], "https://www.tacp.gov.tw/upload/a.jpg")

    def test_dangerous_or_non_https_urls_are_dropped(self):
        bad_values = [
            "javascript:alert(1)",
            "JaVaScRiPt:alert(1)",
            "data:text/html;base64,PHNjcmlwdD48L3NjcmlwdD4=",
            "http://www.tacp.gov.tw/news/1/2",
            "ftp://example.com/a",
            "//evil.example/a",
            "/news/1",
            "vbscript:x",
            " https://example.com/a",
            "https://example.com/a b",
            "https://example.com/a\nb",
            "https://user:pw@example.com/a",
            "https://",
            "https:///path-only",
            "https://example.com/%0d%0a",
            "https://example.com/\\@evil.example",
        ]
        for bad in bad_values:
            result = _defaults(detail=bad, image=bad)
            self.assertEqual(result["link_url"], "", bad)
            self.assertEqual(result["cover_image_url"], "", bad)

    def test_missing_or_non_string_values_become_empty(self):
        for value in (None, "", 123, ["https://example.com"], {"url": "https://example.com"}):
            result = _defaults(detail=value, image=value)
            self.assertEqual(result["link_url"], "")
            self.assertEqual(result["cover_image_url"], "")

    def test_overlong_url_is_dropped_not_truncated(self):
        long_url = "https://example.com/" + "a" * 500
        result = _defaults(detail=long_url, image=long_url)
        self.assertEqual(result["link_url"], "")
        self.assertEqual(result["cover_image_url"], "")
        at_limit = "https://example.com/" + "a" * (500 - len("https://example.com/"))
        self.assertEqual(len(at_limit), 500)
        self.assertEqual(_defaults(detail=at_limit)["link_url"], at_limit)
