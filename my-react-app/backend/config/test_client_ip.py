from django.test import RequestFactory, SimpleTestCase, override_settings
from unittest.mock import patch

from config.client_ip import client_ip, valid_ip_or_none


def _request(remote="127.0.0.1", forwarded=None):
    extra = {"REMOTE_ADDR": remote}
    if forwarded is not None:
        extra["HTTP_X_FORWARDED_FOR"] = forwarded
    return RequestFactory().get("/", **extra)


class ClientIpTests(SimpleTestCase):
    def test_behind_nginx_the_rightmost_forwarded_address_is_the_visitor(self):
        # nginx 把真實來源接在最右邊
        self.assertEqual(client_ip(_request(forwarded="198.51.100.20")), "198.51.100.20")

    def test_addresses_the_client_prepended_are_ignored(self):
        request = _request(forwarded="1.1.1.1, 2.2.2.2, 198.51.100.20")
        self.assertEqual(client_ip(request), "198.51.100.20")

    def test_trusted_proxies_in_the_chain_are_skipped_from_the_right(self):
        with patch.dict("os.environ", {"TRUSTED_PROXY_IPS": "10.0.0.5"}):
            request = _request(forwarded="198.51.100.20, 10.0.0.5")
            self.assertEqual(client_ip(request), "198.51.100.20")

    def test_direct_connections_never_trust_the_header(self):
        """連進來的不是受信任的代理：標頭可能是任何人偽造的，完全不看。"""
        request = _request(remote="203.0.113.9", forwarded="198.51.100.20")
        self.assertEqual(client_ip(request), "203.0.113.9")

    def test_garbage_on_the_right_is_not_used_and_does_not_hide_the_real_address(self):
        self.assertEqual(client_ip(_request(forwarded="198.51.100.20, <script>")), "127.0.0.1")
        self.assertEqual(client_ip(_request(forwarded="not-an-ip")), "127.0.0.1")

    def test_cidr_ranges_in_trusted_proxy_setting_are_supported(self):
        with patch.dict("os.environ", {"TRUSTED_PROXY_IPS": "10.0.0.0/8, bad-entry"}):
            request = _request(remote="10.1.2.3", forwarded="198.51.100.20")
            self.assertEqual(client_ip(request), "198.51.100.20")
            # 網段以外的來源仍不信任標頭
            self.assertEqual(client_ip(_request(remote="11.1.2.3", forwarded="198.51.100.20")), "11.1.2.3")

    def test_no_forwarded_header_falls_back_to_the_connection_address(self):
        self.assertEqual(client_ip(_request()), "127.0.0.1")

    def test_ipv6_and_ipv4_mapped_addresses_are_normalized(self):
        self.assertEqual(client_ip(_request(forwarded="2001:DB8::1")), "2001:db8::1")
        self.assertEqual(client_ip(_request(remote="::ffff:203.0.113.9")), "203.0.113.9")
        self.assertEqual(client_ip(_request(remote="::1", forwarded="198.51.100.20")), "198.51.100.20")

    def test_missing_remote_address_is_unknown(self):
        request = RequestFactory().get("/")
        request.META.pop("REMOTE_ADDR", None)
        self.assertEqual(client_ip(request), "unknown")

    def test_audit_log_ip_helper_rejects_non_addresses(self):
        self.assertIsNone(valid_ip_or_none("unknown"))
        self.assertIsNone(valid_ip_or_none(None))
        self.assertEqual(valid_ip_or_none("198.51.100.20"), "198.51.100.20")
