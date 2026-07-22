"""測試 fastAPI/url_safety.py：proxy_audio／debug_audio／fetch_audio_from_id 都是
先信任一個固定來源、再對它回傳的網址發第二次請求，原本沒有任何檢查，這裡驗證
is_safe_redirect_target 真的會擋掉內網／loopback／link-local 位址，且不會誤擋
一般的公開網址。
"""
from unittest.mock import patch

from fastAPI.url_safety import is_safe_redirect_target


def _fake_addr_info(ip: str):
    return [(2, 1, 6, '', (ip, 443))]


def test_empty_url_rejected():
    assert is_safe_redirect_target("") is False
    assert is_safe_redirect_target(None) is False


def test_non_http_scheme_rejected():
    assert is_safe_redirect_target("ftp://example.com/file") is False
    assert is_safe_redirect_target("file:///etc/passwd") is False


def test_public_https_url_allowed():
    with patch("fastAPI.url_safety.socket.getaddrinfo", return_value=_fake_addr_info("93.184.216.34")):
        assert is_safe_redirect_target("https://example.com/audio.mp3") is True


def test_public_http_url_allowed():
    with patch("fastAPI.url_safety.socket.getaddrinfo", return_value=_fake_addr_info("93.184.216.34")):
        assert is_safe_redirect_target("http://example.com/audio.mp3") is True


def test_cloud_metadata_link_local_address_rejected():
    with patch("fastAPI.url_safety.socket.getaddrinfo", return_value=_fake_addr_info("169.254.169.254")):
        assert is_safe_redirect_target("http://169.254.169.254/latest/meta-data/") is False


def test_private_network_address_rejected():
    with patch("fastAPI.url_safety.socket.getaddrinfo", return_value=_fake_addr_info("10.0.0.5")):
        assert is_safe_redirect_target("http://internal.example/secret") is False


def test_loopback_address_rejected():
    with patch("fastAPI.url_safety.socket.getaddrinfo", return_value=_fake_addr_info("127.0.0.1")):
        assert is_safe_redirect_target("http://localhost:8000/") is False


def test_unresolvable_hostname_rejected():
    import socket as socket_module
    with patch("fastAPI.url_safety.socket.getaddrinfo", side_effect=socket_module.gaierror):
        assert is_safe_redirect_target("https://this-does-not-resolve.invalid/x") is False


def test_missing_hostname_rejected():
    assert is_safe_redirect_target("https:///path-with-no-host") is False
