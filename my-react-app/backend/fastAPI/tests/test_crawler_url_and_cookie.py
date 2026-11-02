"""稽核 FIL-3：爬蟲的網址組裝與 cookie 組裝。

- f"{BASE_URL}{href}"：href 以 "@" 開頭會改變實際主機（需要 ILRDF 網頁被入侵）。
- cookie 值用字串 replace 把關鍵字塞進 JSON：關鍵字裡的引號可以改動其他欄位。
"""
import json
from unittest.mock import MagicMock, patch

import pytest
from bs4 import BeautifulSoup

from fastAPI.routes import crawler


def _soup(html):
    return BeautifulSoup(html, "html.parser")        # 測試環境沒有 html5lib

ORIGINAL_TEMPLATE = (
    '{"til":"tay","words":"@@","isRelatedSantance":false,"charS":"0","charE":"0","category":"","frequency":"",'
    '"dialect":"","search":"","source":"","sourceYear":null,"filterDesc":null,"page":1,"crossTribes":false}'
)


@pytest.mark.parametrize("href, expected", [
    ("/tay/audio/a.mp3", "https://e-dictionary.ilrdf.org.tw/tay/audio/a.mp3"),
    ("tay/search/word.htm?id=3", "https://e-dictionary.ilrdf.org.tw/tay/search/word.htm?id=3"),
    ("https://e-dictionary.ilrdf.org.tw/x.mp3", "https://e-dictionary.ilrdf.org.tw/x.mp3"),
    ("  /tay/a.mp3  ", "https://e-dictionary.ilrdf.org.tw/tay/a.mp3"),
    # "@" 開頭只是網站自己底下的相對路徑，主機不會改變
    ("@evil.test/x", "https://e-dictionary.ilrdf.org.tw/@evil.test/x"),
])
def test_site_url_accepts_the_sites_own_links(href, expected):
    assert crawler.site_url(href) == expected


@pytest.mark.parametrize("href", [
    "//evil.test/x", "https://evil.test/x", "http://e-dictionary.ilrdf.org.tw/x",
    "https://e-dictionary.ilrdf.org.tw@evil.test/x", "https://e-dictionary.ilrdf.org.tw.evil.test/x",
    "https://evil.test\\@e-dictionary.ilrdf.org.tw/x", "javascript:alert(1)", "data:audio/mp3;base64,AAAA",
    "https://e-dictionary.ilrdf.org.tw:8443/x", "https://user:pw@e-dictionary.ilrdf.org.tw/x",
    "", "   ", None, 5,
    # 解析器之間解讀不一致的寫法（反斜線、控制字元）
    "\\\\evil.test\\x", "/\\evil.test/x", "/tay/a\\b.mp3",
    "/tay/a\nb.mp3", "/tay/a\x00b.mp3", "/tay/a\tb.mp3",
])
def test_site_url_refuses_other_hosts_and_odd_shapes(href):
    assert crawler.site_url(href) is None


def test_the_old_string_join_really_was_exploitable():
    # 記錄修正前的行為：直接串接時 "@" 開頭的 href 會讓實際主機變成 evil.test
    from urllib.parse import urlparse

    assert urlparse(f"{crawler.BASE_URL}@evil.test/x").hostname == "evil.test"
    assert urlparse(crawler.site_url("@evil.test/x")).hostname == "e-dictionary.ilrdf.org.tw"


def test_parsed_audio_links_go_through_the_whitelist():
    html = '<html><body><audio src="//evil.test/a.mp3"></audio><div id="ctl00_CPH_content_WUC_DTYcontent_TribesName">x</div></body></html>'
    content = crawler.parse_word_html(_soup(html))
    assert content["word_audio"] is None

    html_ok = '<html><body><audio src="/tay/a.mp3"></audio></body></html>'
    assert crawler.parse_word_html(_soup(html_ok))["word_audio"] == "https://e-dictionary.ilrdf.org.tw/tay/a.mp3"


@pytest.mark.parametrize("keyword", ["balay", "mqaqa'", "你好", "ma-lahang", "x y"])
def test_cookie_is_byte_identical_to_the_old_string_for_ordinary_words(keyword):
    assert crawler.build_search_cookie(keyword) == ORIGINAL_TEMPLATE.replace("@@", crawler.misencode_word(keyword))


@pytest.mark.parametrize("keyword", [
    'a","page":99,"x":"', '"', '\\', 'a\\","crossTribes":true,"y":"', 'a\nb', 'a\r\nSet-Cookie: x=1', "a\x00b",
])
def test_hostile_keywords_cannot_change_other_fields(keyword):
    cookie = crawler.build_search_cookie(keyword)
    parsed = json.loads(cookie)
    assert parsed["page"] == 1 and parsed["crossTribes"] is False and parsed["til"] == "tay"
    assert set(parsed) == set(json.loads(ORIGINAL_TEMPLATE))
    assert parsed["words"] == crawler.misencode_word(keyword)
    assert "\n" not in cookie and "\r" not in cookie


def test_a_semicolon_cannot_start_a_second_cookie():
    cookie = crawler.build_search_cookie("a; admin=1")
    assert ";" not in cookie
    assert json.loads(cookie)["words"] == "a; admin=1"


class _Resp:
    def __init__(self, status=200, location=None, text=""):
        self.status_code = status
        self.headers = {"Location": location} if location else {}
        self.is_redirect = location is not None
        self.text = text


def _session(*responses):
    session = MagicMock()
    session.get.side_effect = list(responses)
    return session


def test_a_redirect_inside_the_site_is_followed():
    session = _session(_Resp(302, "/tay/other"), _Resp(200, text="ok"))
    response = crawler._get_within_site(session, "https://e-dictionary.ilrdf.org.tw/a")
    assert response.text == "ok"
    assert session.get.call_args_list[1].args[0] == "https://e-dictionary.ilrdf.org.tw/tay/other"
    assert all(call.kwargs["allow_redirects"] is False for call in session.get.call_args_list)


def test_a_redirect_to_another_host_is_not_followed():
    session = _session(_Resp(302, "https://evil.test/x"), _Resp(200, text="should not be fetched"))
    assert crawler._get_within_site(session, "https://e-dictionary.ilrdf.org.tw/a") is None
    assert session.get.call_count == 1


def test_a_redirect_loop_stops():
    session = _session(*[_Resp(302, "/loop")] * 10)
    assert crawler._get_within_site(session, "https://e-dictionary.ilrdf.org.tw/a") is None
    assert session.get.call_count == crawler._MAX_REDIRECTS + 1


def test_query_never_requests_a_hijacked_word_link():
    list_html = '<div class="area_block bg-white panel1"><a href="//evil.test/w">x</a></div>'
    session = _session(_Resp(200, text=list_html))
    with patch.object(crawler.requests, "Session", return_value=session),             patch.object(crawler, "BeautifulSoup", lambda text, parser: _soup(text)):
        session.cookies = MagicMock()
        assert crawler.query("balay") is None
    assert session.get.call_count == 1                         # 只有搜尋列表那一次，沒有對 evil.test 發請求


def test_query_sets_the_cookie_built_from_json():
    session = _session(_Resp(200, text="<html></html>"))
    session.cookies = MagicMock()
    with patch.object(crawler.requests, "Session", return_value=session),             patch.object(crawler, "BeautifulSoup", lambda text, parser: _soup(text)):
        crawler.query('a"b')
    value = session.cookies.set.call_args.args[1]
    assert json.loads(value)["words"] == 'a"b'
