"""路線圖 #4 提示快取：證明固定段落真的固定。

快取有沒有命中要看真實 API 的 usage（python manage.py check_prompt_cache --live）；
這裡鎖住我們這一側能控制的部分——會變的東西一律在快取點之後。
"""
import datetime
import hashlib
import json
import io
from unittest.mock import MagicMock, patch

import anthropic
import httpx
from django.core.management import call_command
from django.core.management.base import CommandError

from django.test import SimpleTestCase

from AIModel.management.commands.check_prompt_cache import documented_minimum
from AIModel.services import build_chat_system, build_plan_system, run_tayal_chat, system_text
from AIModel.tests import _mock_chat_client
from AIModel.tools import TOOLS

DAY_ONE = datetime.date(2026, 10, 21)
DAY_TWO = datetime.date(2026, 11, 3)
PROFILE_A = {"level": "初級", "correct": 3, "incorrect": 1, "common_errors": ["lokah（答錯1次）"]}
PROFILE_B = {"level": "中級", "correct": 90, "incorrect": 40, "common_errors": ["su（答錯9次）"]}


class StaticPrefixTest(SimpleTestCase):
    def test_chat_system_has_a_cached_static_block_then_an_uncached_dynamic_block(self):
        system = build_chat_system("阿美語", PROFILE_A, DAY_ONE, with_dictionary=True)
        self.assertEqual([b["type"] for b in system], ["text", "text"])
        self.assertEqual(system[0]["cache_control"], {"type": "ephemeral"})
        self.assertNotIn("cache_control", system[1])

    def test_chat_static_block_ignores_tribe_date_and_learner_profile(self):
        baseline = build_chat_system("阿美語", PROFILE_A, DAY_ONE, with_dictionary=True)[0]["text"]
        for tribe, profile, day in (("泰雅語", PROFILE_B, DAY_TWO), ("排灣語", None, DAY_ONE)):
            with self.subTest(tribe=tribe, day=day):
                self.assertEqual(build_chat_system(tribe, profile, day, with_dictionary=True)[0]["text"], baseline)
        for leaked in ("阿美語", "泰雅語", "2026", "初級", "lokah"):
            self.assertNotIn(leaked, baseline)

    def test_chat_dynamic_block_carries_the_changing_values(self):
        dynamic = build_chat_system("阿美語", PROFILE_A, DAY_ONE)[1]["text"]
        for expected in ("阿美語", "2026-10-21", "初級", "lokah（答錯1次）"):
            self.assertIn(expected, dynamic)

    def test_plan_static_block_ignores_tribe_date_and_learner_profile(self):
        baseline = build_plan_system("阿美語", PROFILE_A, DAY_ONE, "2026-10-22")[0]["text"]
        other = build_plan_system("排灣語", PROFILE_B, DAY_TWO, "2026-11-04")[0]["text"]
        self.assertEqual(baseline, other)
        for leaked in ("阿美語", "排灣語", "2026-", "中級", "lokah", "su（"):   # 靜態範例裡的「初級測驗」是按鈕名稱，不是學生程度
            self.assertNotIn(leaked, baseline)

    def test_plan_dynamic_block_carries_the_dates_the_model_needs(self):
        dynamic = build_plan_system("阿美語", None, DAY_ONE, "2026-10-22")[1]["text"]
        self.assertIn("2026-10-22T10:00:00+08:00", dynamic)

    def test_tool_definitions_match_the_recorded_snapshot(self):
        """工具定義在請求最前面，改任何一個字（名稱、說明、schema、順序）都會讓所有人的快取失效。
        這個測試故意在工具改動時失敗：確定要改的話，更新下面的雜湊，並知道上線後第一批請求會重新寫入快取。"""
        digest = hashlib.sha256(json.dumps(TOOLS, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
        self.assertEqual(digest, "88e0560944a0cd707708941711d202db91e846c7a2c59c23e112f41f6d24bbf6")

    def test_requests_for_different_users_share_the_same_cached_prefix(self):
        seen = []
        for tribe, profile in (("阿美語", PROFILE_A), ("泰雅語", PROFILE_B)):
            client = MagicMock()
            client.messages.create.return_value = _mock_chat_client("好").messages.create.return_value
            run_tayal_chat(client, tribe, "你好", profile, lookup=MagicMock())
            seen.append(client.messages.create.call_args.kwargs)
        self.assertEqual(seen[0]["system"][0], seen[1]["system"][0])
        self.assertEqual(seen[0]["tools"], seen[1]["tools"])
        self.assertNotEqual(system_text(seen[0]["system"]), system_text(seen[1]["system"]))


class DocumentedMinimumTest(SimpleTestCase):
    def test_longer_model_names_win_over_their_shorter_prefix(self):
        self.assertEqual(documented_minimum("claude-sonnet-5-5"), 512)
        self.assertEqual(documented_minimum("claude-sonnet-5"), 1024)
        self.assertIsNone(documented_minimum("some-other-model"))


class CheckPromptCacheCommandTest(SimpleTestCase):
    def _run(self, responses, live=True, count_error=None):
        client = MagicMock()
        if count_error:
            client.messages.count_tokens.side_effect = count_error
        else:
            client.messages.count_tokens.side_effect = [MagicMock(input_tokens=1500), MagicMock(input_tokens=10)]
        out = io.StringIO()
        module = "AIModel.management.commands.check_prompt_cache"
        with patch(f"{module}.get_llm_client", return_value=client), \
                patch(f"{module}.call_claude", side_effect=responses):
            call_command("check_prompt_cache", live=live, stdout=out)
        return out.getvalue()

    @staticmethod
    def _usage(created=0, read=0):
        return MagicMock(usage=MagicMock(input_tokens=20, output_tokens=5,
                                         cache_creation_input_tokens=created, cache_read_input_tokens=read))

    def test_second_request_reading_the_cache_is_a_success(self):
        out = self._run([self._usage(created=1400), self._usage(read=1400), self._usage(read=1400)])
        self.assertIn("固定前綴", out)
        self.assertIn("約 1490 token", out)             # 1500 - 10 的差分
        self.assertIn("提示快取有生效", out)
        self.assertIn("與「工具與固定段落的快取保留」相符", out)

    def test_no_cache_write_at_all_fails_with_the_likely_reason(self):
        with self.assertRaisesMessage(CommandError, "最小可快取長度"):
            self._run([self._usage(), self._usage(), self._usage()])

    def test_write_without_read_fails(self):
        with self.assertRaisesMessage(CommandError, "第二次未觀察到讀取"):
            self._run([self._usage(created=1400), self._usage(), self._usage()])

    def test_tool_choice_none_losing_the_cache_is_reported(self):
        with self.assertRaisesMessage(CommandError, "tool_choice 改成 none 後只讀到 0 token"):
            self._run([self._usage(created=1400), self._usage(read=1400), self._usage()])

    def test_a_small_unexplained_read_on_the_third_request_is_not_accepted_as_success(self):
        # 只讀到基準的 10%：不能當成「整段前綴保留」的證據
        with self.assertRaisesMessage(CommandError, "未觀察到工具與固定段落被完整重用"):
            self._run([self._usage(created=1400), self._usage(read=1400), self._usage(read=140)])

    def test_a_slow_run_is_flagged_as_possibly_a_false_negative(self):
        module = "AIModel.management.commands.check_prompt_cache"
        with patch(f"{module}.time.monotonic", side_effect=[0, 400]):
            with self.assertRaisesMessage(CommandError, "可能是假陰性"):
                self._run([self._usage(created=1400), self._usage(), self._usage()])

    def test_third_request_really_sends_tool_choice_none_with_the_same_prefix(self):
        client = MagicMock()
        client.messages.count_tokens.side_effect = [MagicMock(input_tokens=1500), MagicMock(input_tokens=10)]
        module = "AIModel.management.commands.check_prompt_cache"
        responses = [self._usage(created=1), self._usage(read=1), self._usage(read=1)]
        with patch(f"{module}.get_llm_client", return_value=client), \
                patch(f"{module}.call_claude", side_effect=responses) as call:
            call_command("check_prompt_cache", live=True, stdout=io.StringIO())
        kwargs = [c.kwargs for c in call.call_args_list]
        self.assertEqual([k["tool_choice"] for k in kwargs], [None, None, {"type": "none"}])
        self.assertNotEqual(kwargs[0]["messages"], kwargs[2]["messages"])    # 換一句話，訊息層不可能命中
        self.assertEqual(kwargs[0]["system"], kwargs[2]["system"])
        self.assertEqual(kwargs[0]["tools"], kwargs[2]["tools"])

    def test_api_failures_become_command_errors_not_tracebacks(self):
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages/count_tokens")
        auth = anthropic.AuthenticationError("bad key", response=httpx.Response(401, request=request), body=None)
        with self.assertRaisesMessage(CommandError, "count_tokens 失敗"):
            self._run([], count_error=auth)
        with self.assertRaisesMessage(CommandError, "第 1 次請求（一般請求）失敗"):
            self._run([auth])

    def test_without_live_nothing_paid_is_called(self):
        out = self._run([], live=False)
        self.assertIn("--live", out)
