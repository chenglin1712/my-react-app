"""測試 compare_audio 的 reference_urls SSRF 白名單（第 2 項稽核修正）。"""
from fastAPI.routes.pronunciation.audio_fetch import _is_allowed_reference_url


def test_allows_firebase_storage_https_url():
    assert _is_allowed_reference_url(
        "https://firebasestorage.googleapis.com/v0/b/proj/o/audio.mp3"
    )


def test_allows_storage_googleapis_bucket_url():
    assert _is_allowed_reference_url("https://storage.googleapis.com/bucket/audio.mp3")


def test_allows_subdomain_of_whitelisted_host():
    assert _is_allowed_reference_url("https://sub.storage.googleapis.com/audio.mp3")


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
