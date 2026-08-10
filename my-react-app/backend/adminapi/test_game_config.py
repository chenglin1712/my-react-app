import json
from contextlib import contextmanager
from unittest.mock import patch

from django.test import Client, TestCase
from django.test.utils import override_settings

from config.roles import ADMIN, ANALYST, EDITOR, OWNER

from .models import AuditLog, CrosswordTayalWord, GameConfig


@contextmanager
def _as_role(role):
    """跟 test_quizbank.py 的 _as_role 完全一樣。"""
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("config.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": "test-uid"}
            if role is not None:
                decoded["role"] = role
            with patch("firebase_admin.auth.verify_id_token", return_value=decoded):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _post_json(client, url, headers, payload=None):
    return client.post(url, data=json.dumps(payload or {}), content_type="application/json", **headers)


def _patch_json(client, url, headers, payload):
    return client.patch(url, data=json.dumps(payload), content_type="application/json", **headers)


class GameConfigTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_default_values_match_existing_hardcoded_constants(self):
        # 這組預設值必須跟 listening.py／sentence.py／quiz.py／crossword.py
        # 原本寫死的數字完全一致，確保新增這張表當下，四個遊戲的實際行為不變。
        config = GameConfig.load()
        self.assertEqual(config.listening_questions_per_round, 10)
        self.assertEqual(config.listening_options_per_question, 4)
        self.assertEqual(config.sentence_questions_per_round, 5)
        self.assertEqual(config.sentence_options_per_question, 4)
        self.assertEqual(config.pronunciation_max_audio_mb, 10)
        self.assertEqual(config.pronunciation_excellent_threshold, 80)
        self.assertEqual(config.pronunciation_good_threshold, 60)
        self.assertEqual(config.pronunciation_fair_threshold, 40)
        self.assertEqual(config.pronunciation_pass_threshold, 70)
        self.assertEqual(config.crossword_grid_size, 13)
        self.assertEqual(config.crossword_min_word_length, 4)
        self.assertEqual(config.crossword_max_word_length, 10)
        self.assertEqual(config.crossword_words_per_round, 30)
        self.assertEqual(config.crossword_compute_time_limit_seconds, 2)

    def test_staff_can_view(self):
        with _as_role(ANALYST) as headers:
            response = self.client.get('/adminapi/game-config/', **headers)
        self.assertEqual(response.status_code, 200)

    def test_learner_without_staff_role_cannot_view(self):
        with _as_role(None) as headers:
            response = self.client.get('/adminapi/game-config/', **headers)
        self.assertEqual(response.status_code, 403)

    def test_only_publishers_can_update(self):
        with _as_role(EDITOR) as headers:
            response = _patch_json(self.client, '/adminapi/game-config/', headers, {"listening_questions_per_round": 15})
        self.assertEqual(response.status_code, 403)

        with _as_role(ADMIN) as headers:
            response = _patch_json(self.client, '/adminapi/game-config/', headers, {"listening_questions_per_round": 15})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["listening_questions_per_round"], 15)

    def test_pronunciation_thresholds_must_stay_descending(self):
        with _as_role(OWNER) as headers:
            response = _patch_json(self.client, '/adminapi/game-config/', headers, {
                "pronunciation_excellent_threshold": 50,
                "pronunciation_good_threshold": 60,
                "pronunciation_fair_threshold": 40,
            })
        self.assertEqual(response.status_code, 400)

    def test_pronunciation_thresholds_partial_update_compares_against_existing_values(self):
        # PATCH 只帶一個欄位時，驗證邏輯要拿目前 instance 上其餘欄位的值來比較，
        # 不能只看這次請求帶了什麼——否則單獨調整 good 門檻高過現有 excellent
        # 門檻時會被誤判成合法（因為請求裡完全沒有 excellent 可比較）。
        with _as_role(OWNER) as headers:
            response = _patch_json(self.client, '/adminapi/game-config/', headers, {
                "pronunciation_good_threshold": 95,
            })
        self.assertEqual(response.status_code, 400)

    def test_crossword_min_length_cannot_exceed_max_length(self):
        with _as_role(OWNER) as headers:
            response = _patch_json(self.client, '/adminapi/game-config/', headers, {
                "crossword_min_word_length": 12,
                "crossword_max_word_length": 8,
            })
        self.assertEqual(response.status_code, 400)

    def test_public_endpoint_does_not_require_login(self):
        response = self.client.get('/adminapi/public/game-config/')
        self.assertEqual(response.status_code, 200)
        self.assertIn("crossword_grid_size", response.json())

    def test_public_endpoint_excludes_admin_metadata(self):
        response = self.client.get('/adminapi/public/game-config/')
        data = response.json()
        self.assertNotIn("updated_by", data)
        self.assertNotIn("updated_at", data)

    def test_update_writes_audit_log(self):
        with _as_role(OWNER) as headers:
            _patch_json(self.client, '/adminapi/game-config/', headers, {"crossword_grid_size": 15})
        log = AuditLog.objects.filter(target_type="game_config", action="update").first()
        self.assertIsNotNone(log)


class CrosswordTayalWordTest(TestCase):
    def setUp(self):
        self.client = Client()
        self.word = CrosswordTayalWord.objects.create(word="apah", meaning="糯米飯", sort_order=0)

    def test_staff_can_list(self):
        with _as_role(ANALYST) as headers:
            response = self.client.get('/adminapi/crossword-tayal-words/', **headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["results"]), 1)

    def test_learner_without_staff_role_cannot_list(self):
        with _as_role(None) as headers:
            response = self.client.get('/adminapi/crossword-tayal-words/', **headers)
        self.assertEqual(response.status_code, 403)

    def test_only_publishers_can_create(self):
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/crossword-tayal-words/', headers, {
                "word": "bahat", "meaning": "西瓜", "sort_order": 1,
            })
        self.assertEqual(response.status_code, 403)

        with _as_role(ADMIN) as headers:
            response = _post_json(self.client, '/adminapi/crossword-tayal-words/', headers, {
                "word": "bahat", "meaning": "西瓜", "sort_order": 1,
            })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(CrosswordTayalWord.objects.count(), 2)

    def test_blank_word_rejected(self):
        with _as_role(OWNER) as headers:
            response = _post_json(self.client, '/adminapi/crossword-tayal-words/', headers, {
                "word": "   ", "meaning": "西瓜",
            })
        self.assertEqual(response.status_code, 400)

    def test_update_word(self):
        with _as_role(OWNER) as headers:
            response = _patch_json(
                self.client, f'/adminapi/crossword-tayal-words/{self.word.pk}/', headers, {"meaning": "白米飯"},
            )
        self.assertEqual(response.status_code, 200)
        self.word.refresh_from_db()
        self.assertEqual(self.word.meaning, "白米飯")

    def test_delete_word(self):
        with _as_role(OWNER) as headers:
            response = self.client.delete(f'/adminapi/crossword-tayal-words/{self.word.pk}/', **headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(CrosswordTayalWord.objects.count(), 0)

    def test_editor_cannot_delete(self):
        with _as_role(EDITOR) as headers:
            response = self.client.delete(f'/adminapi/crossword-tayal-words/{self.word.pk}/', **headers)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(CrosswordTayalWord.objects.count(), 1)

    def test_create_writes_audit_log(self):
        with _as_role(OWNER) as headers:
            _post_json(self.client, '/adminapi/crossword-tayal-words/', headers, {
                "word": "banan", "meaning": "高粱",
            })
        log = AuditLog.objects.filter(target_type="crossword_tayal_word", action="create").first()
        self.assertIsNotNone(log)
