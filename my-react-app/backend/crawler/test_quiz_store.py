"""測驗題目由伺服器存進 Firestore（S-06）：形狀、不含答案、失敗處理、每日份數上限。"""
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.test import Client, TestCase

from crawler import quiz_store
from crawler.quiz_store import QuizStoreError, sanitize_questions, save_quiz


class SanitizeTests(TestCase):
    def test_true_false_drops_the_answer_and_adds_fixed_options(self):
        out = sanitize_questions("true_false", [{"question_ab": "a", "image": "i", "audio": None, "answer": "1", "item_id": 9}])
        self.assertEqual(out, [{"question_ab": "a", "image": "i", "audio": None, "options": {"1": "O (符合)", "2": "X (不符合)"}}])

    def test_choice_keeps_present_images_and_drops_the_answer(self):
        out = sanitize_questions("choice", [{"question_ab": "a", "question_ch": "b", "imageA": "x", "imageC": "z", "answer": "2"}])
        self.assertEqual(out, [{"question_ab": "a", "question_ch": "b", "images": {"A": "x", "C": "z"}}])

    def test_matching_and_cloze_never_contain_answer(self):
        matching = sanitize_questions("matching", [{"pairs": [{"a": 1}], "answer": [0]}])
        cloze = sanitize_questions("cloze", [{"passage_ab": "p", "passage_ch": "q", "options": ["x"], "answer": "1"}])
        self.assertNotIn("answer", matching[0])
        self.assertNotIn("answer", cloze[0])
        self.assertEqual(cloze[0]["options"], ["x"])

    def test_unknown_type_or_non_dict_is_refused(self):
        with self.assertRaises(QuizStoreError):
            sanitize_questions("weird", [{}])
        with self.assertRaises(QuizStoreError):
            sanitize_questions("choice", ["not a dict"])


class SaveQuizTests(TestCase):
    def _client(self, ref_id="abc"):
        ref = MagicMock()
        ref.id = ref_id
        client = MagicMock()
        client.collection.return_value.document.return_value = ref
        return client, ref

    def test_writes_owner_title_tribe_and_expiry_and_returns_the_id(self):
        client, ref = self._client("qid1")
        with patch("adminapi.firebase_ops.get_firestore_client", return_value=client):
            result = save_quiz("u1", "amis", "2", {"type": "choice", "questions": [{"question_ab": "a", "answer": "1"}]})
        self.assertEqual(result, "qid1")
        client.collection.assert_called_with("quizs")
        doc = ref.set.call_args[0][0]
        self.assertEqual((doc["userId"], doc["tribe"], doc["title"]), ("u1", "amis", "中級"))
        self.assertIn("expiresAt", doc)
        self.assertNotIn("answer", str(doc["data"]))

    def test_a_firestore_failure_becomes_quiz_store_error(self):
        client, ref = self._client()
        ref.set.side_effect = RuntimeError("firestore down")
        with patch("adminapi.firebase_ops.get_firestore_client", return_value=client), self.assertLogs("crawler.quiz_store", "ERROR"):
            with self.assertRaises(QuizStoreError):
                save_quiz("u1", "amis", "1", {"type": "true_false", "questions": [{"question_ab": "a"}]})

    def test_empty_or_oversized_quizzes_are_not_saved(self):
        with self.assertRaises(QuizStoreError):
            save_quiz("u1", "amis", "1", {"type": "true_false", "questions": []})
        with self.assertRaises(QuizStoreError):
            save_quiz("u1", "amis", "1", {"type": "true_false", "questions": [{}] * (quiz_store.MAX_QUESTIONS + 1)})


class QuizEndpointPersistenceTests(TestCase):
    PART = {"type": "true_false", "questions": [{"question_ab": "a", "answer": "1"}]}

    def setUp(self):
        cache.clear()
        for target, value in (("crawler.views.verify_firebase_token", ({"uid": "u1"}, None)),
                              ("crawler.views.quiz_bank._quiz_disabled_response", None),
                              ("crawler.views.quiz_bank.build_true_false_test_from_db", self.PART)):
            patcher = patch(target, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def _get(self):
        return Client().get("/crawler/", {"level": "1", "tribe": "tayal"})

    def test_the_response_carries_the_quiz_id_from_the_server_write(self):
        with patch("crawler.views.save_quiz", return_value="server-id") as saver:
            body = self._get().json()
        self.assertEqual(body["quizId"], "server-id")
        saver.assert_called_once()

    def test_a_failed_write_is_a_503_and_the_questions_are_not_handed_out(self):
        with patch("crawler.views.save_quiz", side_effect=QuizStoreError("x")):
            response = self._get()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "quiz_persistence_unavailable")
        self.assertNotIn("parts", response.json())

    def test_the_daily_cap_stops_further_quizzes_without_writing(self):
        with patch("crawler.views.save_quiz", return_value="id") as saver, \
                patch("crawler.views.is_ratelimited", side_effect=[False, True]):
            self.assertEqual(self._get().status_code, 429)
        saver.assert_not_called()

    def test_a_quiz_with_no_questions_is_neither_saved_nor_given_an_id(self):
        with patch("crawler.views.quiz_bank.build_true_false_test_from_db", return_value={"type": "true_false", "questions": []}), \
                patch("crawler.views.save_quiz") as saver:
            body = self._get().json()
        saver.assert_not_called()
        self.assertNotIn("quizId", body)
