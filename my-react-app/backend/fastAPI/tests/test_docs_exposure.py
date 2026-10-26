"""互動式 API 文件在正式環境不對外公開（/docs、/redoc、/openapi.json）。"""
from fastapi.testclient import TestClient

from config.debug_flag import is_debug
from fastAPI.main import _docs_kwargs, app


def test_docs_are_switched_off_unless_debugging():
    assert _docs_kwargs(False) == {"docs_url": None, "redoc_url": None, "openapi_url": None}
    assert _docs_kwargs(True) == {}


def test_running_app_matches_the_current_debug_flag():
    paths = {getattr(route, "path", None) for route in app.routes}
    exposed = {"/docs", "/redoc", "/openapi.json"} & paths
    if is_debug():
        assert exposed == {"/docs", "/redoc", "/openapi.json"}
    else:
        assert exposed == set()
        client = TestClient(app)
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert client.get(path).status_code == 404
