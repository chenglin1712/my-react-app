"""GET /api/v1/features：前端用來決定要不要啟動雲端筆記同步。"""
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from fastAPI import feature_flags as F
from fastAPI.routes import features


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(F, "_refresh_if_stale", lambda: None)
    monkeypatch.setattr(F, "_cache", {})
    monkeypatch.setattr(F, "_last_success", time.monotonic())
    app = FastAPI()
    app.include_router(features.router, prefix="/api/v1/features")
    return TestClient(app)


def test_flag_off_or_missing_reports_false(client):
    assert client.get("/api/v1/features").json() == {"notesCloudSync": False}
    F._cache["notes_cloud_sync"] = False
    assert client.get("/api/v1/features").json() == {"notesCloudSync": False}


def test_flag_on_reports_true(client):
    F._cache["notes_cloud_sync"] = True
    assert client.get("/api/v1/features").json() == {"notesCloudSync": True}


def test_database_trouble_is_fail_closed(client, monkeypatch):
    F._cache["notes_cloud_sync"] = True
    monkeypatch.setattr(F, "_last_success", 0.0)
    assert client.get("/api/v1/features").json() == {"notesCloudSync": False}
