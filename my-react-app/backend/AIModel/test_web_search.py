"""路線圖 #19（官方網站查證）的測試。

搜尋本身由 Anthropic 端執行，這裡用假的回應區塊證明我們這一側的行為：網域清單怎麼來、
什麼情況才會帶搜尋工具、來源怎麼過濾、暫停（pause_turn）怎麼接續、內文不含連結。
模型實際會不會乖乖只查官方網站、官方網站改版後結果如何，要用真金鑰另外驗收。
"""
import os
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.test import SimpleTestCase, TestCase

from AIModel import web_search
from AIModel.router import Route
from AIModel.services import (
    NO_OFFICIAL_ANSWER, build_chat_system, choose_flow, run_tayal_chat, stream_tayal_chat, system_text,
)
from AIModel.tests import _mock_response
from AIModel.web_search import (
    DEFAULT_DOMAINS, MAX_PAUSE_CONTINUATIONS, MAX_SOURCES, MAX_USES, count_searches, extract_sources, host_allowed,
    official_domains, web_search_tool,
)
from adminapi.models import FeatureFlag

import datetime


def _cited(text, *urls):
    block = MagicMock(type="text", text=text)
    block.citations = [MagicMock(url=url, title=f"頁面 {i}") for i, url in enumerate(urls)]
    return block


def _search_block():
    block = MagicMock(type="server_tool_use")
    block.name = "web_search"
    return block


def _response(blocks, stop_reason="end_turn"):
    return MagicMock(stop_reason=stop_reason, content=blocks)


def _set_flag(enabled=True):
    FeatureFlag.objects.update_or_create(key=web_search.FLAG_KEY, defaults={"label": "x", "enabled": enabled})


class DomainListTest(SimpleTestCase):
    def test_default_is_the_three_verified_official_domains(self):
        with patch.dict(os.environ, clear=False):
            os.environ.pop("AI_OFFICIAL_DOMAINS", None)
            self.assertEqual(official_domains(), DEFAULT_DOMAINS)

    def test_env_replaces_the_default_completely(self):
        with patch.dict(os.environ, {"AI_OFFICIAL_DOMAINS": " Example.GOV.tw , klokah.tw,klokah.tw"}):
            self.assertEqual(official_domains(), ("example.gov.tw", "klokah.tw"))

    def test_invalid_entries_are_dropped_never_repaired(self):
        bad = "https://cip.gov.tw,*.cip.gov.tw,cip.gov.tw/news,аmazon.com,localhost,127.0.0.1,a b.com,ok.gov.tw"
        with patch.dict(os.environ, {"AI_OFFICIAL_DOMAINS": bad}):
            with self.assertLogs("AIModel.web_search", level="WARNING"):
                self.assertEqual(official_domains(), ("ok.gov.tw",))

    def test_an_empty_setting_means_no_domains_not_every_domain(self):
        for value in ("", " , ,"):
            with self.subTest(value=value), patch.dict(os.environ, {"AI_OFFICIAL_DOMAINS": value}):
                self.assertEqual(official_domains(), ())

    def test_list_size_is_capped(self):
        many = ",".join(f"site{i}.gov.tw" for i in range(30))
        with patch.dict(os.environ, {"AI_OFFICIAL_DOMAINS": many}):
            self.assertEqual(len(official_domains()), 10)


class HostCheckTest(SimpleTestCase):
    DOMAINS = ("cip.gov.tw", "klokah.tw")

    def test_domain_and_subdomains_are_allowed(self):
        for url in ("https://cip.gov.tw/", "https://www.cip.gov.tw/a/b?x=1", "https://web.klokah.tw/x", "https://ALILIN.CIP.GOV.TW/"):
            with self.subTest(url=url):
                self.assertTrue(host_allowed(url, self.DOMAINS))

    def test_lookalikes_and_tricks_are_rejected(self):
        for url in (
            "https://evilcip.gov.tw/", "https://cip.gov.tw.evil.com/", "https://evil.com/cip.gov.tw",
            "https://cip.gov.tw@evil.com/", "https://evil.com#@cip.gov.tw", "http://cip.gov.tw/",
            "https://cip.gov.tw:8443/", "https://user:pw@cip.gov.tw/", "https://cıp.gov.tw/", "javascript:alert(1)",
            "", "not a url", "//cip.gov.tw/", "ftp://cip.gov.tw/",
        ):
            with self.subTest(url=url):
                self.assertFalse(host_allowed(url, self.DOMAINS))

    def test_trailing_dot_host_is_still_the_same_site(self):
        self.assertTrue(host_allowed("https://cip.gov.tw./", self.DOMAINS))


class ExtractSourcesTest(SimpleTestCase):
    DOMAINS = ("cip.gov.tw",)

    def test_only_cited_official_urls_are_sources_in_order_without_duplicates(self):
        blocks = [
            MagicMock(type="server_tool_use"),
            _cited("甲", "https://www.cip.gov.tw/a", "https://evil.example.com/x"),
            _cited("乙", "https://www.cip.gov.tw/a", "https://www.cip.gov.tw/b"),
            MagicMock(type="text", text="沒有引用", citations=None),
        ]
        sources = extract_sources(blocks, self.DOMAINS)
        self.assertEqual([s["url"] for s in sources], ["https://www.cip.gov.tw/a", "https://www.cip.gov.tw/b"])

    def test_capped_and_dict_blocks_work_too(self):
        blocks = [{"type": "text", "text": "x", "citations": [
            {"url": f"https://cip.gov.tw/{i}", "title": f"t{i}"} for i in range(10)]}]
        self.assertEqual(len(extract_sources(blocks, self.DOMAINS)), MAX_SOURCES)

    def test_titles_are_single_line_short_and_tag_free(self):
        block = _cited("x", "https://cip.gov.tw/a")
        block.citations[0].title = "<b>很長\n的標題</b>" + "字" * 200
        title = extract_sources([block], self.DOMAINS)[0]["title"]
        self.assertNotIn("<", title)
        self.assertNotIn("\n", title)
        self.assertLessEqual(len(title), 80)

    def test_missing_title_falls_back_to_the_host_and_junk_urls_are_skipped(self):
        block = _cited("x", "https://cip.gov.tw/a")
        block.citations[0].title = ""
        block.citations.append(MagicMock(url=None, title="沒有網址"))
        block.citations.append(MagicMock(url="https://cip.gov.tw/" + "a" * 600, title="過長"))
        sources = extract_sources([block], self.DOMAINS)
        self.assertEqual(sources, [{"title": "cip.gov.tw", "url": "https://cip.gov.tw/a"}])

    def test_no_blocks_no_sources(self):
        self.assertEqual(extract_sources(None, self.DOMAINS), [])
        self.assertEqual(extract_sources([], self.DOMAINS), [])

    def test_searches_are_counted_from_the_blocks(self):
        self.assertEqual(count_searches([_search_block(), _search_block(), _cited("x")]), 2)


class ToolDefinitionTest(TestCase):
    def test_tool_needs_the_flag(self):
        self.assertIsNone(web_search_tool())
        _set_flag(False)
        self.assertIsNone(web_search_tool())

    def test_tool_is_restricted_to_the_official_domains_with_a_use_cap(self):
        _set_flag(True)
        tool = web_search_tool()
        self.assertEqual(tool["type"], "web_search_20250305")
        self.assertEqual(tool["name"], "web_search")
        self.assertEqual(tool["max_uses"], MAX_USES)
        self.assertEqual(tool["allowed_domains"], list(DEFAULT_DOMAINS))
        self.assertNotIn("blocked_domains", tool)        # API 不允許兩種清單並用

    def test_flag_on_but_no_valid_domain_never_falls_back_to_unrestricted_search(self):
        _set_flag(True)
        with patch.dict(os.environ, {"AI_OFFICIAL_DOMAINS": "https://bad"}), self.assertLogs("AIModel.web_search", level="WARNING"):
            self.assertIsNone(web_search_tool())


class FlowTest(TestCase):
    def _flow(self, intent="culture"):
        with patch.dict(os.environ, {"AI_INTENT_ROUTING": "1"}), \
                patch("AIModel.services.route_message", return_value=Route(intent, "high")):
            return choose_flow(MagicMock(), "阿美族的豐年祭是什麼", [{"role": "user", "content": "x"}], "u1")

    def test_culture_goes_to_the_search_flow_only_when_search_is_available(self):
        self.assertEqual(self._flow(), "chat")
        _set_flag(True)
        self.assertEqual(self._flow(), "culture")

    def test_other_intents_never_use_search(self):
        _set_flag(True)
        for intent in ("vocab_or_grammar", "learning_status"):
            with self.subTest(intent=intent):
                self.assertEqual(self._flow(intent), "chat")


class PromptTest(SimpleTestCase):
    def test_rules_are_added_only_for_the_search_flow(self):
        today = datetime.date(2026, 10, 22)
        without = system_text(build_chat_system("阿美語", None, today))
        with_web = system_text(build_chat_system("阿美語", None, today, with_web=True))
        self.assertNotIn("web_search", without)
        self.assertIn("web_search", with_web)
        self.assertIn("官方網站查不到", with_web)


@patch("AIModel.services.choose_flow", return_value="culture")
class RunChatTest(TestCase):
    def setUp(self):
        cache.clear()
        _set_flag(True)

    def _run(self, responses, **kwargs):
        client = MagicMock()
        client.messages.create.side_effect = responses
        with patch.dict(os.environ, {"AI_INTENT_ROUTING": "1"}):
            result = run_tayal_chat(client, "阿美語", "豐年祭是什麼", None, uid="u1", **kwargs)
        return result, client

    def test_request_carries_the_restricted_search_tool_and_answer_has_official_sources_only(self, _flow):
        text = "豐年祭是阿美族重要的祭典。詳見 https://evil.example.com/x"
        result, client = self._run([_response([
            _search_block(),
            _cited(text, "https://www.cip.gov.tw/a", "https://evil.example.com/x"),
        ])])
        tools = client.messages.create.call_args.kwargs["tools"]
        self.assertEqual(tools[-1]["allowed_domains"], list(DEFAULT_DOMAINS))
        self.assertIn("web_search", system_text(client.messages.create.call_args.kwargs["system"]))
        self.assertEqual(result["sources"], [{"title": "頁面 0", "url": "https://www.cip.gov.tw/a"}])
        self.assertNotIn("http", result["message"])             # 內文不含連結（output_guard），來源另外顯示

    def test_sources_are_not_part_of_the_signature(self, _flow):
        first, _ = self._run([_response([_cited("好", "https://cip.gov.tw/a")])])
        second, _ = self._run([_response([_cited("好", "https://cip.gov.tw/b")])])
        self.assertEqual(first["sig"], second["sig"])

    def test_an_answer_without_any_official_citation_is_replaced_by_the_fixed_message(self, _flow):
        # 模型沒搜尋就憑記憶回答、或只引用到非官方網頁，都不能以「官方查證」的樣子出現
        for blocks in (
            [MagicMock(type="text", text="豐年祭是七月的祭典。", citations=None)],
            [_search_block(), _cited("豐年祭是七月的祭典。", "https://evil.example.com/x")],
        ):
            with self.subTest(blocks=len(blocks)):
                result, _ = self._run([_response(blocks)])
                self.assertEqual(result["message"], NO_OFFICIAL_ANSWER)
                self.assertNotIn("sources", result)

    def test_pause_turn_with_a_dictionary_tool_call_answers_the_tool_first(self, _flow):
        lookup = MagicMock()
        lookup.search.return_value = []
        tool_call = MagicMock(type="tool_use", id="tu9", input={"keywords": ["x"]})
        tool_call.name = "search_words"
        paused = _response([_search_block(), tool_call], stop_reason="pause_turn")
        result, client = self._run([paused, _response([_cited("答案", "https://cip.gov.tw/a")])], lookup=lookup)
        second = client.messages.create.call_args_list[1].kwargs["messages"]
        self.assertEqual(second[-2], {"role": "assistant", "content": paused.content})
        self.assertEqual(second[-1]["role"], "user")
        self.assertEqual(second[-1]["content"][0]["tool_use_id"], "tu9")
        self.assertEqual(result["sources"][0]["url"], "https://cip.gov.tw/a")

    def test_pause_turn_is_continued_with_the_same_tools_and_text_is_joined(self, _flow):
        paused = _response([_search_block(), _cited("前半。", "https://cip.gov.tw/a")], stop_reason="pause_turn")
        done = _response([_cited("後半。", "https://cip.gov.tw/b")])
        result, client = self._run([paused, done])
        self.assertEqual(client.messages.create.call_count, 2)
        second = client.messages.create.call_args_list[1].kwargs
        self.assertEqual(second["messages"][-1], {"role": "assistant", "content": paused.content})
        self.assertEqual(second["tools"][-1]["name"], "web_search")        # 接續時必須帶同樣的工具
        self.assertEqual(result["message"], "前半。後半。")
        self.assertEqual([s["url"] for s in result["sources"]], ["https://cip.gov.tw/a", "https://cip.gov.tw/b"])

    def test_endless_pauses_stop_after_the_cap(self, _flow):
        paused = lambda: _response([_cited("一段。", "https://cip.gov.tw/a")], stop_reason="pause_turn")
        result, client = self._run([paused() for _ in range(MAX_PAUSE_CONTINUATIONS + 1)])
        self.assertEqual(client.messages.create.call_count, MAX_PAUSE_CONTINUATIONS + 1)
        self.assertTrue(result["message"])

    def test_empty_search_answer_gets_the_fixed_not_found_message(self, _flow):
        result, _ = self._run([_response([_search_block()])])
        self.assertEqual(result["message"], NO_OFFICIAL_ANSWER)
        self.assertNotIn("sources", result)

    def test_search_together_with_dictionary_tools_runs_the_client_tool_loop(self, _flow):
        lookup = MagicMock()
        lookup.search.return_value = []
        tool_call = MagicMock(type="tool_use", id="tu1", input={"keywords": ["x"]})
        tool_call.name = "search_words"
        asks_dictionary = _response([tool_call], stop_reason="tool_use")
        result, client = self._run([asks_dictionary, _response([_cited("答案", "https://cip.gov.tw/a")])], lookup=lookup)
        names = [t.get("name") for t in client.messages.create.call_args.kwargs["tools"]]
        self.assertEqual(names, ["search_words", "get_word", "web_search"])
        self.assertEqual(result["sources"][0]["url"], "https://cip.gov.tw/a")

    def test_other_flows_never_get_the_search_tool(self, flow):
        flow.return_value = "chat"
        _, client = self._run([_mock_response("哈囉")])
        self.assertNotIn("tools", client.messages.create.call_args.kwargs)

    def test_flag_off_after_routing_still_means_no_tool(self, _flow):
        _set_flag(False)
        _, client = self._run([_mock_response("哈囉")])
        self.assertNotIn("tools", client.messages.create.call_args.kwargs)


@patch("AIModel.services.choose_flow", return_value="culture")
class StreamChatTest(TestCase):
    def setUp(self):
        cache.clear()
        _set_flag(True)

    def test_stream_done_event_carries_the_official_sources_and_a_link_free_message(self, _flow):
        final = _response([_search_block(), _cited("豐年祭是祭典。", "https://cip.gov.tw/a", "https://evil.example.com/")])
        seen = []

        def fake(*args, **kwargs):
            seen.append(kwargs)

            def gen():
                yield "豐年祭是祭典。 https://evil.example.com/"
                return final
            return gen()

        with patch("AIModel.services.stream_claude", side_effect=fake):
            events = list(stream_tayal_chat(MagicMock(), "阿美語", "豐年祭是什麼", None, uid="u1"))
        done = events[-1]
        self.assertEqual(done["type"], "done")
        self.assertEqual(seen[0]["tools"][-1]["name"], "web_search")
        self.assertEqual([s["url"] for s in done["sources"]], ["https://cip.gov.tw/a"])
        self.assertNotIn("http", done["message"])
        for event in events[:-1]:
            self.assertNotIn("evil.example.com", event.get("t", ""))
