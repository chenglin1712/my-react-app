"""測試 fastAPI/url_safety.py：proxy_audio／debug_audio／fetch_audio_from_id 都是
先信任一個固定來源、再對它回傳的網址發第二次請求，原本沒有任何檢查，這裡驗證
is_safe_redirect_target 真的會擋掉內網／loopback／link-local 位址，且不會誤擋
一般的公開網址。

assert_response_from_safe_peer 則是稽核修正第 7 項：is_safe_redirect_target
檢查當下做的 DNS 解析，跟 httpx 實際連線時重新做的 DNS 解析是兩次獨立的查詢
（DNS rebinding TOCTOU）。這裡用假的 httpx Response（帶假的
extensions["network_stream"]）驗證「檢查實際連線位址」這條路徑本身正確。
"""
import pytest
from unittest.mock import MagicMock, patch

from fastAPI.url_safety import UnsafeConnectionError, assert_response_from_safe_peer, is_safe_redirect_target


def _fake_response(peer_ip):
    response = MagicMock()
    if peer_ip is None:
        response.extensions = {}
    else:
        network_stream = MagicMock()
        network_stream.get_extra_info.return_value = (peer_ip, 443)
        response.extensions = {"network_stream": network_stream}
    return response


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


class TestAssertResponseFromSafePeer:
    def test_allows_response_from_public_peer(self):
        assert_response_from_safe_peer(_fake_response("93.184.216.34"))  # 不應丟例外

    def test_rejects_response_from_private_peer(self):
        # 這正是要堵住的 DNS rebinding 情境：is_safe_redirect_target 檢查當下
        # 解析到的可能是合法公開 IP，但實際連線（這裡用假的 network_stream
        # 模擬）卻連到了內網位址。
        with pytest.raises(UnsafeConnectionError):
            assert_response_from_safe_peer(_fake_response("10.0.0.5"))

    def test_rejects_response_from_loopback_peer(self):
        with pytest.raises(UnsafeConnectionError):
            assert_response_from_safe_peer(_fake_response("127.0.0.1"))

    def test_rejects_response_from_cloud_metadata_peer(self):
        with pytest.raises(UnsafeConnectionError):
            assert_response_from_safe_peer(_fake_response("169.254.169.254"))

    def test_rejects_when_peer_info_unavailable(self):
        # network_stream 或 server_addr 拿不到時，寧可拒絕也不要「放行未知位址」。
        with pytest.raises(UnsafeConnectionError):
            assert_response_from_safe_peer(_fake_response(None))

    def test_works_against_real_httpx_response_shape(self):
        # 確認不是只在假物件上「看起來」對——httpx 的 Response.extensions 真的
        # 是一般 dict，network_stream 真的有 get_extra_info(name) 這個介面
        # （見 fastAPI/url_safety.py 開發時對 httpx 0.28 的實測）。
        import httpx

        stream = MagicMock()
        stream.get_extra_info.return_value = ("8.8.8.8", 443)
        response = httpx.Response(200, extensions={"network_stream": stream})

        assert_response_from_safe_peer(response)  # 不應丟例外
        stream.get_extra_info.assert_called_with("server_addr")
