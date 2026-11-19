"""聽力／造句遊戲的出題門檻（F9）。

干擾選項是從「不同的答案」抽的，所以門檻要看不同答案的數量，不是來源筆數：
很多個詞（或例句）共用少數幾種中文時，只看筆數會放行，結果出一題選項不足的殘缺題目。
現在不同答案不到 4 個就回明確的錯誤，不出題。
"""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from fastAPI import game_config
from fastAPI.routes import listening, sentence


@pytest.fixture
def client():
    from dictionary_db.connect import get_db
    from fastAPI.main import app
    from fastAPI.routes import auth as auth_module

    def _fake_db():
        yield None

    async def _fake_auth():
        return {"uid": "test-user"}

    app.dependency_overrides[get_db] = _fake_db
    app.dependency_overrides[auth_module.verify_firebase_token] = _fake_auth
    try:
        # 限流值放寬，免得同一個測試行程裡多個請求撞到上限；設定值固定住，不被資料庫設定刷新蓋掉
        with patch("fastAPI.rate_limit_config.get_configured_rate", return_value="1000/minute"),              patch.object(game_config, "refresh_game_config_if_stale"),              patch.object(game_config, "LISTENING_OPTIONS_PER_QUESTION", 4),              patch.object(game_config, "SENTENCE_OPTIONS_PER_QUESTION", 4):
            with TestClient(app, raise_server_exceptions=False) as c:
                yield c
    finally:
        app.dependency_overrides.clear()


def _words(meanings):
    return [{"word": f"w{i}", "audio_id": f"a{i}", "meaning": m} for i, m in enumerate(meanings)]


def _sentences(chinese, audio=True):
    return [{"tayal": f"s{i}", "chinese": c, "audio_id": f"a{i}" if audio else None} for i, c in enumerate(chinese)]


def _listening(client, words, count=5):
    with patch.object(listening, "_load_valid_words", return_value=words):
        return client.get(f"/api/v1/listening/questions?tribe=tayal&count={count}")


def _sentence(client, sentences, count=5):
    with patch.object(sentence, "_load_unique_sentences", return_value=sentences):
        return client.get(f"/api/v1/sentence/questions?tribe=tayal&count={count}")


class TestConfiguredOptionCount:
    """後台可以把每題選項數調大：不同答案要至少那麼多，不能悄悄少給選項。"""

    def test_listening_refuses_when_distinct_meanings_are_fewer_than_the_configured_options(self, client):
        with patch.object(game_config, "LISTENING_OPTIONS_PER_QUESTION", 5):
            response = _listening(client, _words([f"意思{i % 4}" for i in range(20)]))      # 只有 4 種意思
        assert response.status_code == 500

    def test_listening_gives_the_configured_number_of_options_when_there_are_enough(self, client):
        with patch.object(game_config, "LISTENING_OPTIONS_PER_QUESTION", 5):
            response = _listening(client, _words([f"意思{i % 5}" for i in range(20)]))
        assert response.status_code == 200
        for q in response.json()["questions"]:
            assert len(q["options"]) == 5 and len(set(q["options"])) == 5

    def test_sentence_refuses_when_distinct_chinese_are_fewer_than_the_configured_options(self, client):
        with patch.object(game_config, "SENTENCE_OPTIONS_PER_QUESTION", 5):
            response = _sentence(client, _sentences([f"中文{i % 4}" for i in range(20)]))
        assert response.status_code == 500

    def test_sentence_gives_the_configured_number_of_options_when_there_are_enough(self, client):
        with patch.object(game_config, "SENTENCE_OPTIONS_PER_QUESTION", 5):
            response = _sentence(client, _sentences([f"中文{i % 5}" for i in range(20)]))
        assert response.status_code == 200
        for q in response.json()["questions"]:
            assert len(q["options"]) == 5 and len(set(q["options"])) == 5

    def test_an_option_count_below_four_still_needs_four_distinct_answers(self, client):
        with patch.object(game_config, "LISTENING_OPTIONS_PER_QUESTION", 2):
            assert _listening(client, _words(["甲", "乙", "丙"] * 5)).status_code == 500


class TestListening:
    def test_many_words_but_only_two_distinct_meanings_is_refused_not_a_broken_question(self, client):
        response = _listening(client, _words(["水", "火"] * 10))      # 20 個詞，只有 2 種意思
        assert response.status_code == 500
        assert response.json()["detail"] == "音頻詞彙不足，無法生成聽力題目"

    @pytest.mark.parametrize("distinct", [1, 2, 3])
    def test_fewer_than_four_distinct_meanings_is_refused(self, client, distinct):
        response = _listening(client, _words([f"意思{i % distinct}" for i in range(30)]))
        assert response.status_code == 500

    def test_exactly_four_distinct_meanings_gives_complete_questions(self, client):
        response = _listening(client, _words([f"意思{i % 4}" for i in range(12)]), count=8)
        assert response.status_code == 200
        questions = response.json()["questions"]
        assert questions
        for q in questions:
            assert len(q["options"]) == 4
            assert len(set(q["options"])) == 4                 # 選項不重複
            assert q["correct"] in q["options"]

    def test_plenty_of_distinct_meanings_behaves_as_before(self, client):
        response = _listening(client, _words([f"意思{i}" for i in range(30)]), count=6)
        assert response.status_code == 200
        assert response.json()["total"] == 6
        for q in response.json()["questions"]:
            assert len(q["options"]) == 4 and len(set(q["options"])) == 4

    def test_fewer_than_four_words_is_still_refused(self, client):
        assert _listening(client, _words(["甲", "乙", "丙"])).status_code == 500

    def test_nothing_valid_is_refused(self, client):
        assert _listening(client, []).status_code == 500


class TestSentence:
    def test_many_sentences_but_only_two_distinct_chinese_is_refused(self, client):
        response = _sentence(client, _sentences(["你好", "謝謝"] * 10))
        assert response.status_code == 500
        assert response.json()["detail"] == "例句資料不足，無法生成句型題目"

    @pytest.mark.parametrize("distinct", [1, 2, 3])
    def test_fewer_than_four_distinct_chinese_is_refused(self, client, distinct):
        assert _sentence(client, _sentences([f"中文{i % distinct}" for i in range(30)])).status_code == 500

    def test_exactly_four_distinct_chinese_gives_complete_questions(self, client):
        response = _sentence(client, _sentences([f"中文{i % 4}" for i in range(12)]), count=8)
        assert response.status_code == 200
        for q in response.json()["questions"]:
            assert len(q["options"]) == 4
            assert len(set(q["options"])) == 4
            assert q["chinese"] in q["options"]

    def test_plenty_of_distinct_chinese_behaves_as_before(self, client):
        response = _sentence(client, _sentences([f"中文{i}" for i in range(30)]), count=6)
        assert response.status_code == 200
        assert response.json()["total"] == 6
        for q in response.json()["questions"]:
            assert len(q["options"]) == 4 and len(set(q["options"])) == 4

    def test_audio_pool_is_used_when_enough_audio_sentences_exist(self, client):
        mixed = _sentences([f"有音{i}" for i in range(6)]) + _sentences([f"無音{i}" for i in range(6)], audio=False)
        response = _sentence(client, mixed, count=6)
        assert response.status_code == 200
        assert all(q["audio_id"] for q in response.json()["questions"])

    def test_options_still_draw_from_all_sentences_when_the_audio_pool_is_small(self, client):
        # 只有 4 句有音訊，但全部不同中文夠多：照舊可出題
        mixed = _sentences([f"有音{i}" for i in range(4)]) + _sentences([f"無音{i}" for i in range(10)], audio=False)
        assert _sentence(client, mixed, count=4).status_code == 200

    def test_fewer_than_four_sentences_is_still_refused(self, client):
        assert _sentence(client, _sentences(["甲", "乙", "丙"])).status_code == 500
