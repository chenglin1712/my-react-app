"""測驗請求的數值欄位驗證（F16）。

ability 給 -1e308 會讓 compute_P_theta 的 math.exp 溢位，次數給負數會讓平滑錯誤率的分母變 0，
都是未捕捉的 500。現在在進入 handler 前就擋成 422。

同時要確認「不擋合法資料」：正常範圍的模型、邊界值、負的作答時間（裝置時鐘被調整）都照常通過。
"""
import math
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from fastAPI.routes.quiz.schemas import (
    MAX_COUNT,
    MAX_MAGNITUDE,
    MAX_RECENT,
    SubmitAnswerFrontendReq,
    TypeStat,
    UserErrorStat,
    UserModelReq,
)

_ANSWER = {"question_id": "q1", "question_type": "word-translate", "word_name": "qu", "correct": True, "time_spent": 2.5}


def _model(**overrides):
    base = {
        "ability": 0.5,
        "user_errors": {"balay": {"attempts": 4, "errors": 1, "recent_results": [0, 1, 0], "recent_times": [1.5, 2.0], "avg_time": 1.75}},
        "type_stats": {"word-translate": {"e": 2, "n": 8}},
        "explorations": {"balay": 0.4},
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------- ability
class TestAbility:
    @pytest.mark.parametrize("value", [-1e308, -0.0001, 1.0001, 5, 1e308, math.inf, -math.inf, math.nan])
    def test_out_of_range_or_non_finite_is_rejected(self, value):
        with pytest.raises(ValidationError):
            UserModelReq(ability=value)

    @pytest.mark.parametrize("value", [0, 0.0, 0.5, 1, 1.0, 0.7])
    def test_values_in_range_including_both_ends_are_accepted(self, value):
        assert UserModelReq(ability=value).ability == value

    def test_omitted_ability_keeps_the_default(self):
        assert UserModelReq().ability == 0.5


# ---------------------------------------------------------------- counts
class TestCounts:
    @pytest.mark.parametrize("field", ["attempts", "errors"])
    def test_negative_counts_are_rejected(self, field):
        with pytest.raises(ValidationError):
            UserErrorStat(**{field: -1})

    def test_errors_above_attempts_is_rejected(self):
        with pytest.raises(ValidationError):
            UserErrorStat(attempts=3, errors=4)

    def test_errors_equal_to_attempts_is_accepted(self):
        stat = UserErrorStat(attempts=3, errors=3)
        assert (stat.attempts, stat.errors) == (3, 3)

    def test_a_brand_new_word_defaults_to_zero(self):
        stat = UserErrorStat()
        assert (stat.attempts, stat.errors) == (0, 0)

    def test_huge_integers_that_would_overflow_a_float_division_are_rejected(self):
        with pytest.raises(ValidationError):
            UserErrorStat(attempts=10 ** 400, errors=0)

    def test_the_upper_limit_itself_is_accepted(self):
        assert UserErrorStat(attempts=MAX_COUNT, errors=MAX_COUNT).attempts == MAX_COUNT

    def test_type_stats_follow_the_same_rules(self):
        for bad in ({"e": -1, "n": 3}, {"e": 3, "n": 1}, {"e": 0, "n": 10 ** 400}):
            with pytest.raises(ValidationError):
                TypeStat(**bad)
        assert TypeStat(e=2, n=2).n == 2

    def test_the_rule_applies_when_nested_in_a_whole_model(self):
        with pytest.raises(ValidationError):
            UserModelReq(**_model(user_errors={"balay": {"attempts": 1, "errors": 5}}))
        with pytest.raises(ValidationError):
            UserModelReq(**_model(type_stats={"word-match": {"e": 5, "n": 1}}))


# ---------------------------------------------------------------- floats
class TestNonFiniteFloats:
    @pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
    def test_nan_and_infinity_are_rejected_everywhere_a_float_is_stored(self, bad):
        with pytest.raises(ValidationError):
            UserErrorStat(avg_time=bad)
        with pytest.raises(ValidationError):
            UserErrorStat(recent_times=[1.0, bad])
        with pytest.raises(ValidationError):
            UserModelReq(explorations={"balay": bad})
        with pytest.raises(ValidationError):
            SubmitAnswerFrontendReq(user_data={}, answer={**_ANSWER, "time_spent": bad})

    def test_a_negative_answer_time_is_still_accepted(self):
        """裝置時鐘被調整時，作答時間會算出負值；這是以前就能通過的資料，不能因此鎖死使用者。"""
        req = SubmitAnswerFrontendReq(user_data=_model(), answer={**_ANSWER, "time_spent": -3.0})
        assert req.answer.time_spent == -3.0
        assert UserErrorStat(recent_times=[-1.0, 2.0], avg_time=-0.5).avg_time == -0.5


# ---------------------------------------------------------------- finite but huge
class TestHugeFiniteValues:
    """有限但極大的值（1e308）相加會溢位成無限大，之後回應不是合法 JSON；整數太大則在除法時溢位。"""

    def test_the_boundary_itself_is_accepted_and_just_past_it_is_not(self):
        assert UserErrorStat(avg_time=MAX_MAGNITUDE, recent_times=[-MAX_MAGNITUDE]).avg_time == MAX_MAGNITUDE
        for bad in (MAX_MAGNITUDE * 10, -MAX_MAGNITUDE * 10, 1e308, -1e308):
            with pytest.raises(ValidationError):
                UserErrorStat(avg_time=bad)
            with pytest.raises(ValidationError):
                UserErrorStat(recent_times=[bad])
            with pytest.raises(ValidationError):
                UserModelReq(explorations={"balay": bad})
            with pytest.raises(ValidationError):
                SubmitAnswerFrontendReq(user_data={}, answer={**_ANSWER, "time_spent": bad})

    def test_recent_results_cannot_hold_integers_that_overflow_a_division(self):
        with pytest.raises(ValidationError):
            UserErrorStat(recent_results=[10 ** 400])
        assert UserErrorStat(recent_results=[0, 1, 1, 0, 1]).recent_results == [0, 1, 1, 0, 1]

    @pytest.mark.parametrize("field", ["recent_results", "recent_times"])
    def test_the_recent_lists_have_a_size_limit_well_above_what_the_app_keeps(self, field):
        assert len(getattr(UserErrorStat(**{field: [0] * MAX_RECENT}), field)) == MAX_RECENT
        with pytest.raises(ValidationError):
            UserErrorStat(**{field: [0] * (MAX_RECENT + 1)})


# ---------------------------------------------------------------- compute_Tw
class TestTimeRatioStaysFinite:
    """平均時間趨近 0 時，時間比值不能溢位：它會進到 Bq，而 Bq 會放進題目的 meta 回傳。"""

    @pytest.mark.parametrize("tiny", [5e-324, 1e-320, 1e-310, 1e-299, 1e-12])
    def test_a_near_zero_average_is_treated_like_no_average(self, tiny):
        from fastAPI.routes.quiz.irt import compute_Tw
        # 跟平均是 0 的既有行為一致：以 1 秒當基準，所以比值就是平均作答秒數本身
        assert compute_Tw([5.0], tiny) == 5.0 == compute_Tw([5.0], 0.0)

    @pytest.mark.parametrize("tiny", [5e-324, 1e-299, 1e-12, -1e-299])
    def test_the_whole_score_chain_stays_finite_even_with_a_large_coefficient(self, tiny):
        from fastAPI.routes.quiz.irt import compute_Bq, compute_Tw
        t_w = compute_Tw([1e9], tiny)
        # 係數故意放大：就算 BETA 被後台調得很大，也不會溢位
        bq = 1.7 * t_w + compute_Bq(1.0, 1.0, 1.0, t_w, 1.0)
        assert math.isfinite(t_w) and math.isfinite(bq)

    def test_the_worst_accepted_inputs_go_through_the_whole_scoring_chain_without_error(self):
        """可接受的最極端輸入（平均時間剛好在門檻、最近時間 1e9）走完 T_w → Bq → 分數，
        以及 Dq → bw → P(theta)（這條跟 Bq 無關，所以 exp 不會被 Bq 影響）。"""
        from fastAPI.routes.quiz import irt
        t_w = irt.compute_Tw([1e9], 1e-9)
        bq = irt.compute_Bq(1.0, 1.0, 1.0, t_w, 1.0)
        _, bw = irt.compute_Dq_and_bw(irt.compute_smoothed_error_rate(10_000_000, 10_000_000), 1.0, 1.0)
        for theta in (0.0, 0.5, 1.0):
            p = irt.compute_P_theta(theta, bw, 1.0, irt.DEFAULT_GUESS)
            assert 0.0 <= p <= 1.0
            assert math.isfinite(irt.compute_score(p, bq))

    def test_ordinary_values_are_unchanged(self):
        from fastAPI.routes.quiz.irt import compute_Tw
        assert compute_Tw([2.0, 4.0], 3.0) == 1.0
        assert compute_Tw([6.0], 3.0) == 2.0
        assert compute_Tw([], 3.0) == 1.0
        assert compute_Tw([2.0], 0.0) == 2.0      # 沒有平均時間（0）：以 1 秒當基準，跟以前一樣
        assert compute_Tw([-2.0], -1.0) == 2.0    # 時鐘被調整造成的負值照舊可算
        assert compute_Tw([0.5], 0.001) == pytest.approx(500.0)   # 很短但真實的作答時間照舊
        assert compute_Tw([3.0], None) == 3.0


# ---------------------------------------------------------------- legit data
class TestLegitDataIsNotRejected:
    def test_a_normal_model_passes(self):
        req = UserModelReq(**_model())
        assert req.ability == 0.5 and req.user_errors["balay"].errors == 1

    def test_an_empty_model_passes(self):
        assert UserModelReq(**{}).user_errors == {}

    def test_a_model_after_one_real_submission_round_trips(self):
        """後端自己更新出來的模型（見 submit_answer_frontend）再送回來也要通過。"""
        updated = _model(ability=1.0, user_errors={"balay": {"attempts": 5, "errors": 5, "recent_results": [1, 1, 1, 1, 1],
                                                            "recent_times": [0.0, 0.0], "avg_time": 0.0}})
        assert UserModelReq(**updated).ability == 1.0


# ---------------------------------------------------------------- 端點
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
        with TestClient(app, raise_server_exceptions=False) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


class TestEndpoints:
    """壞資料在進入 handler 之前就回 422，不會跑到數學運算才炸成 500。"""

    @pytest.mark.parametrize("model", [
        {"ability": -1e308},
        {"ability": 2},
        {"user_errors": {"balay": {"attempts": -1, "errors": 0}}},
        {"user_errors": {"balay": {"attempts": 1, "errors": 2}}},
        {"type_stats": {"word-translate": {"e": 3, "n": 1}}},
    ])
    def test_generate_quiz_answers_422_for_a_bad_model(self, client, model):
        response = client.post("/api/v1/quiz/generate_quiz_frontend?tribe=tayal", json=model)
        assert response.status_code == 422

    def test_submit_answer_answers_422_for_a_bad_model(self, client):
        body = {"user_data": {"ability": -1e308}, "answer": _ANSWER}
        assert client.post("/api/v1/quiz/submit_answer_frontend?tribe=tayal", json=body).status_code == 422

    def test_submit_answer_answers_422_for_a_non_finite_time(self, client):
        # JSON 標準沒有 NaN，但 Python 的 json 模組會收 NaN／Infinity 字面值，所以要自己擋
        raw = ('{"user_data": {}, "answer": {"question_id": "q1", "question_type": "word-translate", '
               '"word_name": "qu", "correct": true, "time_spent": Infinity}}')
        response = client.post("/api/v1/quiz/submit_answer_frontend?tribe=tayal", content=raw,
                               headers={"Content-Type": "application/json"})
        assert response.status_code == 422

    def test_the_422_body_keeps_type_loc_and_msg_but_not_the_submitted_value(self, client):
        response = client.post("/api/v1/quiz/generate_quiz_frontend?tribe=tayal", json={"ability": 7})
        assert response.status_code == 422
        errors = response.json()["detail"]
        assert errors and all(set(e) == {"type", "loc", "msg"} for e in errors)
        assert errors[0]["loc"][-1] == "ability" and errors[0]["msg"]

    def test_a_plain_type_error_elsewhere_still_answers_422_in_the_same_shape(self, client):
        response = client.post("/api/v1/quiz/generate_quiz_frontend?tribe=tayal", json={"ability": "high"})
        assert response.status_code == 422
        assert all(set(e) == {"type", "loc", "msg"} for e in response.json()["detail"])

    def test_two_finite_but_huge_times_are_rejected_instead_of_overflowing_later(self, client):
        """Codex 找到的組合：模型裡已有 1e308，再送 time_spent=1e308，平均時間會溢位。現在一開始就擋成 422。"""
        model = _model(user_errors={"balay": {"attempts": 1, "errors": 0, "recent_times": [1e308], "avg_time": 1e308}})
        body = {"user_data": model, "answer": {**_ANSWER, "time_spent": 1e308}}
        assert client.post("/api/v1/quiz/submit_answer_frontend?tribe=tayal", json=body).status_code == 422

    def test_a_good_model_gets_past_validation(self, client):
        """通過驗證後才會進到查詢詞庫：讓詞庫查不到東西，應該明確回 500「No words in DB」（不是 422）。"""
        with patch("fastAPI.routes.quiz.api.load_all_words", return_value=[]):
            response = client.post("/api/v1/quiz/generate_quiz_frontend?tribe=tayal", json=_model())
        assert response.status_code == 500
        assert response.json() == {"detail": "No words in DB"}
