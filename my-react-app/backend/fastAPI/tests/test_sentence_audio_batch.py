"""O22：/sentence-audio/ 原本每個 token 各查兩次資料庫；改成整批查詢後，結果必須與逐詞查詢相同，
且查詢次數不隨 token 數量增加。用記憶體內 SQLite 跑真實 SQL。"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from dictionary_db.connect import get_db
from dictionary_db.model import Base, Tribe, Word, WordAudio
from fastAPI.rate_limit import limiter
from fastAPI.routes.dictionary import audio_proxy


@pytest.fixture
def env(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine, tables=[Tribe.__table__, Word.__table__, WordAudio.__table__])
    Session = sessionmaker(bind=engine)
    seed = Session()
    seed.add_all([Tribe(id="t-tayal", name="泰雅語", slug="tayal"), Tribe(id="t-amis", name="阿美語", slug="amis")])
    seed.add_all([
        Word(id="w1", tribe_id="t-tayal", name="Balay"),
        Word(id="w2", tribe_id="t-tayal", name="cyux"),
        Word(id="w3", tribe_id="t-tayal", name="nohaudio"),
        Word(id="w4", tribe_id="t-amis", name="balay"),            # 別族同名，不能被取到
        Word(id="w5", tribe_id="t-tayal", name="dup"),
        Word(id="w6", tribe_id="t-tayal", name="DUP"),             # 同名（大小寫不同）：固定取 id 較小的 w5
    ])
    seed.add_all([
        WordAudio(word_id="w1", file_id="f-balay-2", sort_order=2),
        WordAudio(word_id="w1", file_id="f-balay-1", sort_order=1),
        WordAudio(word_id="w2", file_id="f-cyux", sort_order=1),
        WordAudio(word_id="w4", file_id="f-amis", sort_order=1),
        WordAudio(word_id="w5", file_id="f-dup5", sort_order=1),
        WordAudio(word_id="w6", file_id="f-dup6", sort_order=1),
    ])
    seed.commit()
    seed.close()

    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.include_router(audio_proxy.router)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db
    monkeypatch.setattr(audio_proxy, "resolve_tribe_name", lambda t: "泰雅語")
    return TestClient(app), engine


def _post(client, sentence):
    return client.post("/sentence-audio/", json={"sentence": sentence, "tribe": "泰雅語"})


def _routes_prefix(client):
    return "/sentence-audio/"


def test_matches_per_token_behaviour(env):
    client, _ = env
    path = _routes_prefix(client)
    res = client.post(path, json={"sentence": "balay cyux nohaudio missing BALAY cyux dup", "tribe": "泰雅語"})
    assert res.status_code == 200
    # 大小寫不分地對到詞條；沒音檔／查不到的略過；同一個 fileId 只出現一次；別族的詞不會被取到；
    # 取音檔時依 sort_order，第一個是 f-balay-1；同名詞條固定取 id 最小的 w5。
    assert res.json()["audioTokens"] == [
        {"word": "balay", "fileId": "f-balay-1"},
        {"word": "cyux", "fileId": "f-cyux"},
        {"word": "dup", "fileId": "f-dup5"},
    ]


def test_query_count_does_not_grow_with_token_count(env):
    client, engine = env
    path = _routes_prefix(client)
    counts = []
    for sentence in ("balay", "balay cyux nohaudio missing dup " * 20):
        n = {"c": 0}

        def _count(*a, **k):
            n["c"] += 1

        event.listen(engine, "before_cursor_execute", _count)
        try:
            assert client.post(path, json={"sentence": sentence, "tribe": "泰雅語"}).status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", _count)
        counts.append(n["c"])
    assert counts[1] == counts[0]          # 舊寫法：每個 token 2 次，會是 100 次以上
    assert counts[1] <= 3


def test_many_distinct_tokens_are_chunked(env, monkeypatch):
    client, _ = env
    path = _routes_prefix(client)
    monkeypatch.setattr(audio_proxy, "_LOOKUP_CHUNK", 2)
    res = client.post(path, json={"sentence": "balay cyux dup nohaudio missing", "tribe": "泰雅語"})
    assert [t["word"] for t in res.json()["audioTokens"]] == ["balay", "cyux", "dup"]
