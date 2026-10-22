"""建議問題（#13）、輕量格式提示詞（#14）、長對話預算（#15）。"""
import datetime
from unittest.mock import patch

from django.core.cache import cache
from django.test import Client, TestCase

from AIModel.followups import (
    DEFAULT_STARTERS, MAX_FOLLOWUPS, PLAN_FOLLOWUPS, followups_for_entries, followups_for_plan, starter_suggestions,
)
from AIModel.services import HISTORY_CHAR_BUDGET, build_chat_system, build_messages, system_text, _with_entries


class StarterSuggestionsTest(TestCase):
    def test_no_profile_gives_the_default_three(self):
        self.assertEqual(starter_suggestions(None), list(DEFAULT_STARTERS))

    def test_markup_in_a_word_is_stripped_not_passed_through(self):
        self.assertNotIn("<", starter_suggestions({"common_errors": ["<b>ab</b>"]})[0])

    def test_the_most_common_error_leads_and_the_list_stays_at_three(self):
        result = starter_suggestions({"common_errors": ["lokah", "other"]})
        self.assertEqual(result[0], "幫我複習最常錯的「lokah」")
        self.assertEqual(len(result), MAX_FOLLOWUPS)

    def test_hostile_or_oversized_words_are_not_put_into_a_suggestion(self):
        for bad in ("https://evil.example.com/x", "字" * 50, ""):
            with self.subTest(bad=bad):
                self.assertEqual(starter_suggestions({"common_errors": [bad]}), list(DEFAULT_STARTERS))


class ReplyFollowupsTest(TestCase):
    def test_follow_ups_use_the_first_looked_up_word(self):
        cards = [{"word": "lokah", "chinese": "好", "audio": "", "word_id": "1"}]
        result = followups_for_entries(cards)
        self.assertEqual(len(result), 3)
        self.assertTrue(all("lokah" in text for text in result))

    def test_nothing_to_suggest_means_no_field_at_all(self):
        self.assertEqual(followups_for_entries([]), [])
        self.assertEqual(followups_for_entries([{"word": "字" * 50}]), [])

        class Recorder:
            inner = None

            def cards(self, _text):
                return []

            def known_names(self):
                return set()
        self.assertNotIn("followups", _with_entries({"message": "好"}, Recorder()))
        self.assertNotIn("followups", _with_entries({"message": "好"}, None))

    def test_plan_follow_ups_are_fixed_templates(self):
        self.assertEqual(followups_for_plan(), list(PLAN_FOLLOWUPS))


class QuotaSuggestionsTest(TestCase):
    def setUp(self):
        cache.clear()

    @patch("AIModel.views.load_profile", return_value={"common_errors": ["lokah"], "level": "beginner"})
    def test_quota_carries_starter_suggestions(self, _profile):
        body = Client().get("/AIModel/quota/").json()
        self.assertEqual(body["suggestions"][0], "幫我複習最常錯的「lokah」")

    @patch("AIModel.views.load_profile", return_value=None)
    def test_without_a_profile_the_defaults_are_returned(self, _profile):
        self.assertEqual(Client().get("/AIModel/quota/").json()["suggestions"], list(DEFAULT_STARTERS))


class LightFormatPromptTest(TestCase):
    def test_prompt_allows_only_the_light_formats(self):
        prompt = system_text(build_chat_system("泰雅", None, datetime.date(2026, 10, 22)))
        self.assertIn("**粗體**", prompt)
        self.assertIn("不要用標題、表格、程式碼區塊、連結、圖片或 HTML", prompt)
        self.assertNotIn("不用Markdown", prompt)


class LongConversationBudgetTest(TestCase):
    def test_sixty_turns_stay_inside_the_budget_and_start_with_the_user(self):
        history = []
        for i in range(60):
            history.append({"role": "user", "text": f"第{i}個問題" + "問" * 40})
            history.append({"role": "assistant", "text": f"第{i}個回答" + "答" * 180})
        current = "最新的問題"
        messages = build_messages(history, current)
        self.assertEqual(HISTORY_CHAR_BUDGET, 4000)          # 預算本身被改大時要有人有意識地改這裡
        self.assertLessEqual(sum(len(m["content"]) for m in messages), 4000)
        self.assertEqual(messages[0]["role"], "user")
        self.assertEqual(messages[-1], {"role": "user", "content": current})
        self.assertIn("第59個回答", messages[-2]["content"])        # 留下的是最近的，不是最舊的
        self.assertNotIn("第0個問題", " ".join(m["content"] for m in messages))
