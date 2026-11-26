"""WP-5：測驗端點的限流與請求本文上限（稽核 BE4-05）。"""
import pytest
from pydantic import ValidationError

from fastAPI.rate_limit import limiter
from fastAPI.routes.quiz import schemas
from fastAPI.routes.quiz.schemas import UserModelReq


def test_every_quiz_endpoint_has_its_own_rate_limit():
    registered = set(limiter._dynamic_route_limits)  # 限流值是 callable（後台可調），slowapi 存在 dynamic 表
    for name in ("generate_quiz_frontend", "submit_answer_frontend", "get_research_consent",
                 "put_research_consent", "get_rule_summary"):
        assert f"fastAPI.routes.quiz.api.{name}" in registered, name


def test_user_model_accepts_a_normal_request():
    UserModelReq(favorites={"word": True}, ability=0.4)


def test_user_model_rejects_too_many_entries():
    with pytest.raises(ValidationError):
        UserModelReq(favorites={str(i): True for i in range(schemas.MAX_USER_MODEL_ENTRIES + 1)})


def test_user_model_rejects_very_long_keys():
    with pytest.raises(ValidationError):
        UserModelReq(favorites={"x" * (schemas.MAX_USER_MODEL_KEY_LENGTH + 1): True})
