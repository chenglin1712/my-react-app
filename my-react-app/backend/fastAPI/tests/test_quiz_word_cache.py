"""測試 fastAPI/routes/quiz.py 的 load_all_words 快取存的是 WordDTO 而非
SQLAlchemy ORM 物件：原本快取直接存 db.query(Word).all() 的結果，這些物件跟
建立當下的 db session 綁在一起，session 關閉後若讀取沒預先載入的欄位/關聯
（例如 Word.tribe_ref）會丟 DetachedInstanceError。改成快照成獨立 DTO 後，
即使把假的 db session 關掉／丟棄，快取內容仍然完好可用。
"""
from unittest.mock import MagicMock

from fastAPI.routes.quiz import repository as quiz_module
from fastAPI.routes.keyed_cache import KeyedCache
from dictionary_db.model import Word
from fastAPI.routes.quiz.schemas import WordDTO
from fastAPI.routes.quiz.repository import load_all_words


def _make_fake_word(word_id, name, frequency):
    w = MagicMock(spec=Word)
    w.id = word_id
    w.name = name
    w.frequency = frequency
    return w


def test_load_all_words_caches_dto_not_orm_object(monkeypatch):
    monkeypatch.setattr(quiz_module, "_words_cache", KeyedCache())
    monkeypatch.setattr(quiz_module, "_word_explanations_cache", {})
    monkeypatch.setattr(quiz_module, "_word_audios_cache", {})
    monkeypatch.setattr(quiz_module, "load_explanation_items_for_words", lambda db, tribe_id=None: {})
    monkeypatch.setattr(quiz_module, "load_audio_items_for_words", lambda db, tribe_id=None: {})

    fake_word = _make_fake_word("w1", "balay", 50)
    fake_db = MagicMock()
    fake_db.query.return_value.filter.return_value.all.return_value = [fake_word]

    result = load_all_words(fake_db, tribe_id="tribe-1")

    assert len(result) == 1
    assert isinstance(result[0], WordDTO)
    assert result[0] == WordDTO(id="w1", name="balay", frequency=50)


def test_cached_dto_survives_after_db_session_is_gone(monkeypatch):
    # 模擬「快取住的物件跟 session 生命週期脫鉤」：DTO 建好之後，就算原本的
    # db/query 物件被丟棄或關閉，快取裡的 DTO 仍然是完整、獨立可用的純資料。
    monkeypatch.setattr(quiz_module, "_words_cache", KeyedCache())
    monkeypatch.setattr(quiz_module, "_word_explanations_cache", {})
    monkeypatch.setattr(quiz_module, "_word_audios_cache", {})
    monkeypatch.setattr(quiz_module, "load_explanation_items_for_words", lambda db, tribe_id=None: {})
    monkeypatch.setattr(quiz_module, "load_audio_items_for_words", lambda db, tribe_id=None: {})

    fake_word = _make_fake_word("w1", "balay", 50)
    fake_db = MagicMock()
    fake_db.query.return_value.filter.return_value.all.return_value = [fake_word]

    load_all_words(fake_db, tribe_id="tribe-1")
    del fake_db  # 模擬 session 已經關閉/不存在

    # 第二次呼叫直接吃快取，不需要 db，也不會因為 db 不見了而出錯。
    cached = load_all_words(None, tribe_id="tribe-1")
    assert cached == [WordDTO(id="w1", name="balay", frequency=50)]


def test_load_all_words_cache_hit_does_not_use_contains_then_get(monkeypatch):
    """回歸測試（E4）：快取命中時只做一次 get()。這份快取在被問 `in` 的瞬間會清空自己，
    模擬別的執行緒剛好失效快取；舊寫法會回傳 None（呼叫端再對 None 迴圈就 TypeError）。"""
    class _ClearsWhenAskedContains(KeyedCache):
        def __contains__(self, key):
            self._values.clear()
            return True

    cache = _ClearsWhenAskedContains()
    cache._values["tribe-1"] = [WordDTO(id="w1", name="balay", frequency=50)]
    monkeypatch.setattr(quiz_module, "_words_cache", cache)

    assert load_all_words(None, tribe_id="tribe-1") == [WordDTO(id="w1", name="balay", frequency=50)]


def test_empty_word_list_is_a_valid_cache_hit(monkeypatch):
    """該族語沒有詞時，空清單也是合法快取結果：之後（連 db 都沒有）仍要回傳空清單，不能重查。"""
    monkeypatch.setattr(quiz_module, "_words_cache", KeyedCache())
    monkeypatch.setattr(quiz_module, "_word_explanations_cache", {})
    monkeypatch.setattr(quiz_module, "_word_audios_cache", {})
    monkeypatch.setattr(quiz_module, "load_explanation_items_for_words", lambda db, tribe_id=None: {})
    monkeypatch.setattr(quiz_module, "load_audio_items_for_words", lambda db, tribe_id=None: {})
    fake_db = MagicMock()
    fake_db.query.return_value.filter.return_value.all.return_value = []

    assert load_all_words(fake_db, tribe_id="tribe-empty") == []
    queries_after_first = fake_db.query.call_count
    assert load_all_words(fake_db, tribe_id="tribe-empty") == []
    assert load_all_words(None, tribe_id="tribe-empty") == []
    assert fake_db.query.call_count == queries_after_first
