"""O14：對話歷史裁切與詞條卡片的比對，改成「只算一次」之後，結果必須與舊寫法逐筆相同。
舊寫法原樣放在這裡當對照基準，用隨機資料比較。"""
import random

from django.test import SimpleTestCase
from unittest.mock import patch

from AIModel import entries, services


def _old_build_messages(history, user_message, budget):
    kept = []
    for m in history:
        if kept and kept[-1]["role"] == m["role"]:
            kept[-1]["content"] += "\n" + m["text"]
        else:
            kept.append({"role": m["role"], "content": m["text"]})
    while kept and kept[-1]["role"] == "user":
        kept.pop()

    def total():
        return len(user_message) + sum(len(m["content"]) for m in kept)

    while kept and total() > budget:
        kept.pop(0)
    while kept and kept[0]["role"] != "user":
        kept.pop(0)
    return [*kept, {"role": "user", "content": user_message}]


def _old_cards_for_reply(entries_list, reply_text):
    cards = []
    for entry in entries_list:
        word = " ".join(entry["name"].split())
        if len(word) < entries._MIN_WORD_LEN or not entries.mentions(reply_text, word):
            continue
        cards.append({"word_id": entry["word_id"], "word": word, "chinese": entry["chinese"], "audio": entry["audio"]})
        if len(cards) == entries.MAX_CARDS:
            break
    return cards


class BuildMessagesEquivalenceTest(SimpleTestCase):
    def _random_history(self, rng):
        n = rng.randint(0, 14)
        history = []
        for _ in range(n):
            role = rng.choice(["user", "user", "assistant"]) if rng.random() < 0.5 else rng.choice(["user", "assistant"])
            history.append({"role": role, "text": "x" * rng.randint(0, 120)})
        return history

    def test_random_histories_and_budgets_give_the_same_messages_as_the_old_loop(self):
        rng = random.Random(2026)
        for _ in range(600):
            history = self._random_history(rng)
            user_message = "q" * rng.randint(0, 80)
            budget = rng.choice([0, 1, 50, 200, 500, 2000, 100000])
            want = _old_build_messages([dict(m) for m in history], user_message, budget)
            with patch.object(services, "HISTORY_CHAR_BUDGET", budget):
                got = services.build_messages([dict(m) for m in history], user_message)
            self.assertEqual(got, want, f"history={history} budget={budget}")

    def test_the_callers_history_list_is_not_modified(self):
        history = [{"role": "user", "text": "a"}, {"role": "user", "text": "b"}, {"role": "assistant", "text": "c"}]
        snapshot = [dict(m) for m in history]
        services.build_messages(history, "next")
        self.assertEqual(history, snapshot)

    def test_adjacent_same_role_messages_are_merged_with_newlines_and_the_first_kept_is_a_user_message(self):
        history = [{"role": "assistant", "text": "orphan"}, {"role": "user", "text": "a"},
                   {"role": "user", "text": "b"}, {"role": "assistant", "text": "c"}]
        got = services.build_messages(history, "now")
        self.assertEqual([m["role"] for m in got], ["user", "assistant", "user"])
        self.assertEqual(got[0]["content"], "a\nb")


class CardsForReplyEquivalenceTest(SimpleTestCase):
    def test_random_replies_give_the_same_cards_as_normalising_per_entry(self):
        rng = random.Random(7)
        pieces = ["balay", "Lokah", "ya'", "yaya", "é", "cyux", " ", ",", "mami", "é"]   # 含組合符號寫法
        for _ in range(300):
            entry_list = [
                {"word_id": f"w{i}", "name": rng.choice(pieces) + rng.choice(["", " ", "x"]),
                 "chinese": "釋義", "audio": None}
                for i in range(rng.randint(0, 25))
            ]
            reply = "".join(rng.choice(pieces) for _ in range(rng.randint(0, 40)))
            self.assertEqual(entries.cards_for_reply(entry_list, reply), _old_cards_for_reply(entry_list, reply))

    def test_mentions_still_requires_a_whole_word(self):
        self.assertTrue(entries.mentions("我說 Lokah 你好", "lokah"))
        self.assertFalse(entries.mentions("lokahan", "lokah"))
        self.assertFalse(entries.mentions("yaya'", "yaya"))
        self.assertFalse(entries.mentions("abc", ""))
