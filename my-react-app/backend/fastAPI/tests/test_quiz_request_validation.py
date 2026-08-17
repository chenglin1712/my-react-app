"""測試 fastAPI/routes/quiz.py 新增的 Pydantic 請求驗證與例外處理（稽核修正第 1 項）：
generate_quiz_frontend／submit_answer_frontend 原本用 Body(...): dict 收原始 dict，
沒有 schema 也沒有 try/except，型別錯誤資料（例如 ability 傳成字串）會讓
compute_P_theta() 的 math.exp() 等運算丟出未捕捉的 500。
"""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from fastAPI.main import app
from fastAPI.routes import auth as auth_module
from fastAPI.routes.quiz.schemas import SubmitAnswerFrontendReq, UserModelReq, WordDTO
from dictionary_db.connect import get_db


def _fake_get_db():
    yield None


async def _fake_auth():
    return {"uid": "test-user"}


@pytest.fixture
def client():
    app.dependency_overrides[get_db] = _fake_get_db
    app.dependency_overrides[auth_module.verify_firebase_token] = _fake_auth
    try:
        # raise_server_exceptions=False：generate_quiz_frontend／
        # submit_answer_frontend 不再自己包 except Exception（P4 review
        # BE-28，見 quiz/api.py 的說明），未攔截的例外交給 main.py 的全域
        # handler 處理；預設的 TestClient 在回應送出後仍會把原始例外重新
        # 拋出給測試本身，關掉這個行為才能對 test_generate_quiz_masks_
        # internal_exception 的回應內容斷言。
        with TestClient(app, raise_server_exceptions=False) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


# ------------------------- Pydantic model 本身 -------------------------
class TestUserModelReq:
    def test_defaults_when_omitted(self):
        req = UserModelReq()
        assert req.ability == 0.5
        assert req.user_errors == {}

    def test_rejects_non_numeric_ability(self):
        # 稽核報告的重現案例：ability 傳成字串會讓 compute_P_theta() 的
        # math.exp(-a_q*(theta-bw)) 丟未捕捉的 TypeError。
        with pytest.raises(ValidationError):
            UserModelReq(ability="not_a_number")

    def test_rejects_non_numeric_recent_time(self):
        with pytest.raises(ValidationError):
            UserModelReq(user_errors={"balay": {"recent_times": ["oops"]}})


class TestSubmitAnswerFrontendReq:
    def test_rejects_non_numeric_time_spent(self):
        # 稽核報告的重現案例
        with pytest.raises(ValidationError):
            SubmitAnswerFrontendReq(
                user_data={},
                answer={
                    "word_name": "qu",
                    "question_type": "word-translate",
                    "correct": True,
                    "time_spent": "oops",
                },
            )

    def test_accepts_well_formed_answer(self):
        req = SubmitAnswerFrontendReq(
            user_data={},
            answer={
                "question_id": "q1",
                "word_name": "qu",
                "question_type": "word-translate",
                "correct": True,
                "time_spent": 3.5,
            },
        )
        assert req.answer.time_spent == 3.5


# ------------------------- 端到端：型別錯誤回 422，不是未捕捉的 500 -------------------------
def test_generate_quiz_rejects_non_numeric_ability(client):
    response = client.post(
        "/api/v1/quiz/generate_quiz_frontend",
        params={"tribe": "tayal"},
        json={"ability": "not_a_number"},
    )
    assert response.status_code == 422


def test_submit_answer_rejects_non_numeric_time_spent(client):
    response = client.post(
        "/api/v1/quiz/submit_answer_frontend",
        params={"tribe": "tayal"},
        json={
            "user_data": {},
            "answer": {
                "word_name": "qu",
                "question_type": "word-translate",
                "correct": True,
                "time_spent": "oops",
            },
        },
    )
    assert response.status_code == 422


def test_submit_answer_rejects_missing_answer(client):
    response = client.post(
        "/api/v1/quiz/submit_answer_frontend",
        params={"tribe": "tayal"},
        json={"user_data": {}},
    )
    assert response.status_code == 422


# ------------------------- 成功路徑：省略欄位仍能吃到預設值正常運作 -------------------------
def test_generate_quiz_accepts_empty_body_with_defaults(client):
    fake_words = [
        WordDTO(id="w1", name="balay", frequency=10),
        WordDTO(id="w2", name="cyux", frequency=5),
    ]
    with patch("fastAPI.routes.quiz.api.load_all_words", return_value=fake_words):
        response = client.post(
            "/api/v1/quiz/generate_quiz_frontend", params={"tribe": "tayal"}, json={}
        )
    assert response.status_code == 200
    assert "questions" in response.json()


# ------------------------- 內部例外：只回通用訊息，不外洩例外內容 -------------------------
def test_generate_quiz_masks_internal_exception(client):
    fake_words = [WordDTO(id="w1", name="balay", frequency=10)]
    with patch("fastAPI.routes.quiz.api.load_all_words", return_value=fake_words), \
         patch("fastAPI.routes.quiz.api._score_candidates", side_effect=RuntimeError("internal db path leaked")):
        response = client.post(
            "/api/v1/quiz/generate_quiz_frontend", params={"tribe": "tayal"}, json={}
        )
    assert response.status_code == 500
    assert "internal db path leaked" not in response.text
    assert response.json()["detail"] == "伺服器發生錯誤，請稍後再試"
