"""測試 compare_audio 的 reference_urls SSRF 白名單（第 2 項稽核修正）。"""
import pytest

from fastAPI.routes.pronunciation.audio_fetch import _is_allowed_reference_url


@pytest.fixture(autouse=True)
def _project_bucket(monkeypatch):
    # 稽核 BE4-13：白名單除了網域，還要限定本專案的 bucket 與錄音路徑
    monkeypatch.setenv("VITE_FIREBASE_STORAGE_BUCKET", "proj")


def test_allows_firebase_storage_https_url():
    assert _is_allowed_reference_url(
        "https://firebasestorage.googleapis.com/v0/b/proj/o/pronunciations%2Ftayal%2Flokah%2Fa_u1.webm?alt=media&token=t"
    )


def test_allows_storage_googleapis_bucket_url():
    assert _is_allowed_reference_url("https://storage.googleapis.com/proj/pronunciations/tayal/lokah/a_u1.webm")


def test_allows_subdomain_of_whitelisted_host():
    assert _is_allowed_reference_url("https://proj.storage.googleapis.com/pronunciations/tayal/lokah/a_u1.webm")


def test_rejects_someone_elses_bucket_even_on_a_google_host():
    """任何人都能開自己的 GCS bucket 放一份音檔當參考音，不能只看網域。"""
    assert not _is_allowed_reference_url("https://firebasestorage.googleapis.com/v0/b/evil/o/pronunciations%2Fa.webm")
    assert not _is_allowed_reference_url("https://storage.googleapis.com/evil/pronunciations/a.webm")
    assert not _is_allowed_reference_url("https://evil.storage.googleapis.com/pronunciations/a.webm")


def test_rejects_paths_outside_the_recordings_area():
    assert not _is_allowed_reference_url("https://firebasestorage.googleapis.com/v0/b/proj/o/private%2Fa.webm")
    assert not _is_allowed_reference_url("https://storage.googleapis.com/proj/other/a.webm")


def test_rejects_urls_that_hide_path_separators_with_percent_encoding():
    """整條路徑先解碼會讓 %2F 偽裝成分隔符號，解析結果和 Google 實際的解讀不一致。"""
    assert not _is_allowed_reference_url("https://firebasestorage.googleapis.com/v0%2Fb%2Fproj%2Fo%2Fpronunciations%2Fa.webm")


def test_rejects_dot_segments_that_the_http_client_would_normalise_into_another_bucket():
    """httpx 送出請求前會移除 ./.. 路徑段；檢查的路徑和實際送出的路徑必須一致。"""
    assert not _is_allowed_reference_url(
        "https://firebasestorage.googleapis.com/v0/b/proj/o/pronunciations/../../../evil/o/pronunciations%2Fa.webm?alt=media"
    )
    assert not _is_allowed_reference_url("https://storage.googleapis.com/proj/pronunciations/../../evil/pronunciations/a.webm")
    assert not _is_allowed_reference_url("https://proj.storage.googleapis.com/pronunciations/../private/a.webm")
    assert not _is_allowed_reference_url("https://firebasestorage.googleapis.com/v0/b/proj/o/pronunciations%2F..%2F..%2Fx")


def test_rejects_unrecognised_url_shapes():
    assert not _is_allowed_reference_url("https://firebasestorage.googleapis.com/v0/b/proj")
    assert not _is_allowed_reference_url("https://storage.googleapis.com/")


def test_without_a_configured_bucket_falls_back_to_domain_only(monkeypatch):
    monkeypatch.delenv("VITE_FIREBASE_STORAGE_BUCKET", raising=False)
    assert _is_allowed_reference_url("https://storage.googleapis.com/anything/audio.mp3")


def test_rejects_non_whitelisted_host():
    assert not _is_allowed_reference_url("https://evil.example.com/audio.mp3")


def test_rejects_internal_metadata_host():
    assert not _is_allowed_reference_url("http://169.254.169.254/latest/meta-data/")


def test_rejects_http_scheme_even_for_allowed_host():
    assert not _is_allowed_reference_url("http://firebasestorage.googleapis.com/audio.mp3")


def test_rejects_lookalike_suffix_host():
    # 字串前綴相似但不是真正子網域的攻擊寫法要被擋下
    assert not _is_allowed_reference_url(
        "https://notfirebasestorage.googleapis.com.evil.com/x"
    )


def test_rejects_malformed_url():
    assert not _is_allowed_reference_url("not a url")


def test_rejects_empty_string():
    assert not _is_allowed_reference_url("")
