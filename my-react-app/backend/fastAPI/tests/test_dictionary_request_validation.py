"""測試 fastAPI/routes/dictionary.py 新增的 Pydantic 請求驗證：/keys/、/all/、
/sentence-audio/ 原本直接吃 request.json() 後用 dict.get() 存取，沒有型別／長度
驗證。這裡直接測 Pydantic model 本身（不用 TestClient 整套啟動 app——app 的
lifespan 會觸發真正的 DB 快取預熱，不需要為了測請求驗證而牽扯進去）。
"""
import pytest
from pydantic import ValidationError

from fastAPI.routes.dictionary import AllWordsRequest, MultiWordSearchRequest, SentenceAudioRequest


class TestMultiWordSearchRequest:
    def test_accepts_normal_words_list(self):
        req = MultiWordSearchRequest(words=["balay", "cyux"], tribe="泰雅")
        assert req.words == ["balay", "cyux"]

    def test_defaults_when_omitted(self):
        req = MultiWordSearchRequest()
        assert req.words == []
        assert req.tribe == "泰雅"

    def test_rejects_too_many_words(self):
        with pytest.raises(ValidationError):
            MultiWordSearchRequest(words=["a"] * 51)

    def test_rejects_word_too_long(self):
        with pytest.raises(ValidationError):
            MultiWordSearchRequest(words=["x" * 101])

    def test_accepts_word_at_max_length(self):
        req = MultiWordSearchRequest(words=["x" * 100])
        assert len(req.words[0]) == 100


class TestAllWordsRequest:
    def test_defaults_when_omitted(self):
        req = AllWordsRequest()
        assert req.tribe == "泰雅"
        assert req.sort_order == "asc"
        assert req.favorite_names == []

    def test_rejects_invalid_sort_order(self):
        with pytest.raises(ValidationError):
            AllWordsRequest(sort_order="sideways")

    def test_rejects_frequency_out_of_range(self):
        with pytest.raises(ValidationError):
            AllWordsRequest(frequency=6)
        with pytest.raises(ValidationError):
            AllWordsRequest(frequency=0)

    def test_rejects_negative_offset(self):
        with pytest.raises(ValidationError):
            AllWordsRequest(offset=-1)

    def test_rejects_limit_too_large(self):
        with pytest.raises(ValidationError):
            AllWordsRequest(limit=10000)

    def test_rejects_too_many_favorite_names(self):
        with pytest.raises(ValidationError):
            AllWordsRequest(favorite_names=["w"] * 501)


class TestSentenceAudioRequest:
    def test_accepts_normal_sentence(self):
        req = SentenceAudioRequest(sentence="uwah maku balay", tribe="布農")
        assert req.sentence == "uwah maku balay"

    def test_defaults_when_omitted(self):
        req = SentenceAudioRequest()
        assert req.sentence == ""
        assert req.tribe == "布農"

    def test_rejects_tribe_as_list(self):
        # 這是原本會讓 TRIBE_MAP.get(tribe, tribe) 對不可雜湊的 key 丟
        # TypeError、變成未處理 500 的具體例子——現在應該在這裡就被擋下來。
        with pytest.raises(ValidationError):
            SentenceAudioRequest(tribe=["a", "b"])

    def test_rejects_sentence_too_long(self):
        with pytest.raises(ValidationError):
            SentenceAudioRequest(sentence="x" * 2001)
