"""測試 config/url_safety.py（原本放在 fastAPI/ 底下，見 P4 review BE-7 搬到
Django/FastAPI 共用層）：proxy_audio／debug_audio／fetch_audio_from_id 都是
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

from config.url_safety import UnsafeConnectionError, assert_response_from_safe_peer, is_safe_redirect_target


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
    with patch("config.url_safety.socket.getaddrinfo", return_value=_fake_addr_info("93.184.216.34")):
        assert is_safe_redirect_target("https://example.com/audio.mp3") is True


def test_public_http_url_allowed():
    with patch("config.url_safety.socket.getaddrinfo", return_value=_fake_addr_info("93.184.216.34")):
        assert is_safe_redirect_target("http://example.com/audio.mp3") is True


def test_cloud_metadata_link_local_address_rejected():
    with patch("config.url_safety.socket.getaddrinfo", return_value=_fake_addr_info("169.254.169.254")):
        assert is_safe_redirect_target("http://169.254.169.254/latest/meta-data/") is False


def test_private_network_address_rejected():
    with patch("config.url_safety.socket.getaddrinfo", return_value=_fake_addr_info("10.0.0.5")):
        assert is_safe_redirect_target("http://internal.example/secret") is False


def test_loopback_address_rejected():
    with patch("config.url_safety.socket.getaddrinfo", return_value=_fake_addr_info("127.0.0.1")):
        assert is_safe_redirect_target("http://localhost:8000/") is False


def test_unresolvable_hostname_rejected():
    import socket as socket_module
    with patch("config.url_safety.socket.getaddrinfo", side_effect=socket_module.gaierror):
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
        # （見 config/url_safety.py 開發時對 httpx 0.28 的實測）。
        import httpx

        stream = MagicMock()
        stream.get_extra_info.return_value = ("8.8.8.8", 443)
        response = httpx.Response(200, extensions={"network_stream": stream})

        assert_response_from_safe_peer(response)  # 不應丟例外
        stream.get_extra_info.assert_called_with("server_addr")


# ---- 稽核 FIL-2：CGNAT／內嵌 IPv4 的 IPv6／連線時固定解析結果 ----
import ipaddress  # noqa: E402

import httpx  # noqa: E402

from config.url_safety import PinnedTarget, is_public_ip, pin_target  # noqa: E402


@pytest.mark.parametrize("address", [
    "100.100.100.200", "100.64.0.1", "100.127.255.254",                  # CGNAT（100.64.0.0/10）
    "192.0.0.8", "198.18.0.1", "0.0.0.0", "240.0.0.1", "255.255.255.255",
    "10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "224.0.0.1",
    "::1", "::", "fe80::1", "fc00::1", "ff02::1",
    "::ffff:10.0.0.1", "::ffff:100.100.100.200", "::ffff:127.0.0.1",    # IPv4-mapped
    "2002:0a00:0001::", "2002:6464:64c8::",                              # 6to4 內嵌 10.0.0.1／100.100.100.200
    "64:ff9b::a00:1", "64:ff9b::7f00:1",                                 # NAT64 內嵌 10.0.0.1／127.0.0.1
])
def test_non_public_addresses_are_refused(address):
    assert is_public_ip(ipaddress.ip_address(address)) is False


@pytest.mark.parametrize("address", ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "::ffff:93.184.216.34"])
def test_public_addresses_are_allowed(address):
    assert is_public_ip(ipaddress.ip_address(address)) is True


def test_cgnat_hostname_is_refused_by_the_redirect_check():
    with patch("config.url_safety.socket.getaddrinfo", return_value=_fake_addr_info("100.100.100.200")):
        assert is_safe_redirect_target("https://metadata.example.com/a") is False


def test_cgnat_peer_is_refused_after_connecting():
    with pytest.raises(UnsafeConnectionError):
        assert_response_from_safe_peer(_fake_response("100.100.100.200"))
    with pytest.raises(UnsafeConnectionError):
        assert_response_from_safe_peer(_fake_response("::ffff:10.0.0.5"))


class TestPinTarget:
    def test_connects_to_the_checked_ip_and_keeps_the_original_host_and_sni(self):
        with patch("config.url_safety.socket.getaddrinfo", return_value=_fake_addr_info("93.184.216.34")) as resolve:
            pinned = pin_target("https://cdn.example.com/dir/a.mp3?x=1")
        assert pinned.url == "https://93.184.216.34/dir/a.mp3?x=1"
        assert pinned.headers == {"Host": "cdn.example.com", "Connection": "close"}
        assert pinned.extensions == {"sni_hostname": "cdn.example.com"}
        resolve.assert_called_once()

    def test_keeps_an_explicit_port_in_both_the_url_and_the_host_header(self):
        with patch("config.url_safety.socket.getaddrinfo", return_value=_fake_addr_info("93.184.216.34")):
            pinned = pin_target("http://cdn.example.com:8080/a.mp3")
        assert pinned.url == "http://93.184.216.34:8080/a.mp3"
        assert pinned.headers == {"Host": "cdn.example.com:8080", "Connection": "close"}
        assert pinned.extensions == {}                          # http 沒有 TLS，不需要 SNI

    def test_ipv6_result_is_bracketed(self):
        with patch("config.url_safety.socket.getaddrinfo", return_value=[(10, 1, 6, "", ("2606:4700:4700::1111", 443, 0, 0))]):
            assert pin_target("https://cdn.example.com/a").url == "https://[2606:4700:4700::1111]/a"

    def test_prefers_ipv4_when_both_families_resolve(self):
        infos = [(10, 1, 6, "", ("2606:4700:4700::1111", 443, 0, 0)), (2, 1, 6, "", ("93.184.216.34", 443))]
        with patch("config.url_safety.socket.getaddrinfo", return_value=infos):
            assert pin_target("https://cdn.example.com/a").url == "https://93.184.216.34/a"

    def test_one_bad_address_among_good_ones_refuses_the_whole_name(self):
        # 只擋第一個結果不夠：攻擊者可以回多筆記錄，等連線時剛好挑到內網那筆
        infos = [(2, 1, 6, "", ("93.184.216.34", 443)), (2, 1, 6, "", ("100.100.100.200", 443))]
        with patch("config.url_safety.socket.getaddrinfo", return_value=infos):
            with pytest.raises(UnsafeConnectionError):
                pin_target("https://cdn.example.com/a")

    @pytest.mark.parametrize("url", [
        "ftp://cdn.example.com/a", "file:///etc/passwd", "https:///a", "https://user:pw@cdn.example.com/a",
        "https://cdn.example.com:notaport/a", "http://127.0.0.1/a", "http://[::ffff:10.0.0.1]/a",
        "http://100.100.100.200/latest/meta-data", "https://[64:ff9b::a00:1]/a",
    ])
    def test_unsafe_or_malformed_urls_are_refused(self, url):
        with pytest.raises(UnsafeConnectionError):
            pin_target(url)

    def test_unresolvable_name_is_refused(self):
        import socket as socket_module

        with patch("config.url_safety.socket.getaddrinfo", side_effect=socket_module.gaierror):
            with pytest.raises(UnsafeConnectionError):
                pin_target("https://nope.example.com/a")

    def test_a_public_ip_literal_passes_through_unchanged(self):
        assert pin_target("https://93.184.216.34/a") == PinnedTarget("https://93.184.216.34/a")

    def test_the_request_really_goes_to_the_pinned_ip_with_the_original_host(self):
        # 用 httpx 的 MockTransport 看實際送出的請求：目標是 IP、Host 標頭是原網域、SNI 擴充欄位帶原網域
        seen = {}

        def handler(request):
            seen["url"], seen["host"], seen["sni"] = str(request.url), request.headers["host"], request.extensions.get("sni_hostname")
            return httpx.Response(200, content=b"ok")

        with patch("config.url_safety.socket.getaddrinfo", return_value=_fake_addr_info("93.184.216.34")):
            pinned = pin_target("https://cdn.example.com/a.mp3")
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            client.get(pinned.url, headers=pinned.headers, extensions=pinned.extensions)
        assert seen == {"url": "https://93.184.216.34/a.mp3", "host": "cdn.example.com", "sni": "cdn.example.com"}

    def test_dns_changing_after_the_check_cannot_redirect_the_connection(self):
        # DNS rebinding：第一次解析公開、之後解析成內網。固定解析結果後只會有一次查詢，
        # 後續就算 DNS 變了，請求的目標仍是當初檢查過的 IP。
        answers = iter([_fake_addr_info("93.184.216.34"), _fake_addr_info("10.0.0.5")])
        with patch("config.url_safety.socket.getaddrinfo", side_effect=lambda *a, **k: next(answers)) as resolve:
            pinned = pin_target("https://cdn.example.com/a.mp3")
        assert "93.184.216.34" in pinned.url
        assert resolve.call_count == 1


def test_pinned_requests_ask_the_server_to_close_the_connection():
    # 連線池以 URL 裡的 IP 當 key；兩個網域同 IP 時不能重用彼此的 TLS 連線
    with patch("config.url_safety.socket.getaddrinfo", return_value=_fake_addr_info("93.184.216.34")):
        assert pin_target("https://a.example.com/x").headers["Connection"] == "close"


# ---- 用真的 TLS 伺服器驗證 sni_hostname：連 IP，但憑證要以原網域驗證 ----
import shutil as _shutil  # noqa: E402
import socket as _socket  # noqa: E402
import ssl as _ssl  # noqa: E402
import subprocess as _subprocess  # noqa: E402
import threading as _threading  # noqa: E402


@pytest.fixture
def tls_server(tmp_path):
    """本機 TLS 伺服器：憑證只對 example.test 有效（自簽，同時當作信任根）。回傳 (port, ca 檔路徑, 收到的 SNI 清單)。"""
    if _shutil.which("openssl") is None:
        pytest.skip("沒有 openssl，略過真實 TLS 測試")
    key, cert = tmp_path / "k.pem", tmp_path / "c.pem"
    _subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(key), "-out", str(cert),
         "-days", "1", "-subj", "/CN=example.test", "-addext", "subjectAltName=DNS:example.test"],
        check=True, capture_output=True,
    )
    context = _ssl.SSLContext(_ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(str(cert), str(key))
    seen = []
    context.sni_callback = lambda sock, name, ctx: seen.append(name)

    listener = _socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(5)
    port = listener.getsockname()[1]
    stop = _threading.Event()

    def serve():
        listener.settimeout(0.2)
        while not stop.is_set():
            try:
                conn, _ = listener.accept()
            except (_socket.timeout, OSError):
                continue
            try:
                with context.wrap_socket(conn, server_side=True) as tls:
                    tls.recv(4096)
                    tls.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
            except (_ssl.SSLError, OSError):
                pass

    thread = _threading.Thread(target=serve, daemon=True)
    thread.start()
    yield port, str(cert), seen
    stop.set()
    thread.join(timeout=2)
    listener.close()


def test_sni_hostname_is_what_the_certificate_is_checked_against(tls_server):
    port, ca, seen = tls_server
    url = f"https://127.0.0.1:{port}/a.mp3"
    with httpx.Client(verify=ca) as client:
        ok = client.get(url, headers={"Host": "example.test"}, extensions={"sni_hostname": "example.test"})
        assert ok.status_code == 200 and ok.text == "ok"
        # 憑證不是發給 wrong.test：必須失敗，不能退化成不驗證或改驗 IP
        with pytest.raises(httpx.ConnectError):
            client.get(url, headers={"Host": "wrong.test"}, extensions={"sni_hostname": "wrong.test"})
    assert "example.test" in seen


def test_connecting_by_ip_without_the_sni_extension_fails_certificate_verification(tls_server):
    port, ca, _ = tls_server
    with httpx.Client(verify=ca) as client:
        with pytest.raises(httpx.ConnectError):
            client.get(f"https://127.0.0.1:{port}/a.mp3")           # 沒有 sni_hostname：驗的是 IP，憑證不符
