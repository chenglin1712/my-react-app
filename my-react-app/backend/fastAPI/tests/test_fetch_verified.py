"""scripts/fetch_verified.py：下載後核對 SHA-256 才放到目的地（稽核 SUP-8）。"""
import hashlib
import importlib.util
import io
import os
import tempfile
import unittest
from unittest.mock import patch

_SCRIPT = os.path.join(os.path.dirname(__file__), "..", "..", "..", "scripts", "fetch_verified.py")
_spec = importlib.util.spec_from_file_location("fetch_verified", _SCRIPT)
fetch_verified = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fetch_verified)


class _FakeResponse(io.BytesIO):
    def __init__(self, data, url="https://download.example/model.pth"):
        super().__init__(data)
        self._url = url

    def geturl(self):
        return self._url

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _sha(data):
    return hashlib.sha256(data).hexdigest()


class FetchVerifiedTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.dest = os.path.join(self.dir.name, "hub", "model.pth")

    def _run(self, data, expected, url="https://download.example/model.pth", final_url=None, max_bytes=1024):
        resp = _FakeResponse(data, final_url or url)
        with patch.object(fetch_verified.urllib.request, "urlopen", return_value=resp):
            return fetch_verified.fetch_verified(url, self.dest, expected, max_bytes)

    def test_matching_hash_places_the_file(self):
        data = b"weights" * 10
        self.assertEqual(self._run(data, _sha(data)), len(data))
        with open(self.dest, "rb") as f:
            self.assertEqual(f.read(), data)

    def test_hash_mismatch_leaves_nothing_behind(self):
        with self.assertRaises(SystemExit) as ctx:
            self._run(b"tampered", _sha(b"original"))
        self.assertIn("SHA-256 不符", str(ctx.exception))
        self.assertFalse(os.path.exists(self.dest))
        self.assertEqual(os.listdir(os.path.dirname(self.dest)), [])  # 連暫存檔都清掉

    def test_mismatch_does_not_overwrite_an_existing_good_file(self):
        os.makedirs(os.path.dirname(self.dest))
        with open(self.dest, "wb") as f:
            f.write(b"good")
        with self.assertRaises(SystemExit):
            self._run(b"tampered", _sha(b"other"))
        with open(self.dest, "rb") as f:
            self.assertEqual(f.read(), b"good")

    def test_plain_http_url_is_rejected_before_any_request(self):
        with patch.object(fetch_verified.urllib.request, "urlopen") as opener:
            with self.assertRaises(SystemExit):
                fetch_verified.fetch_verified("http://download.example/m.pth", self.dest, _sha(b"x"))
        opener.assert_not_called()

    def test_redirect_to_non_https_is_rejected(self):
        data = b"x"
        with self.assertRaises(SystemExit) as ctx:
            self._run(data, _sha(data), final_url="http://elsewhere.example/m.pth")
        self.assertIn("非 https", str(ctx.exception))
        self.assertFalse(os.path.exists(self.dest))

    def test_download_over_the_size_cap_is_aborted(self):
        data = b"a" * 100
        with self.assertRaises(SystemExit) as ctx:
            self._run(data, _sha(data), max_bytes=50)
        self.assertIn("大小上限", str(ctx.exception))
        self.assertFalse(os.path.exists(self.dest))

    def test_a_download_that_trickles_past_the_total_deadline_is_aborted(self):
        data = b"a" * 100
        first_call = iter([0])  # 第一次（算 deadline）回 0，之後每次都回很大的值＝時間過了很久
        with patch.object(fetch_verified.time, "monotonic", side_effect=lambda: next(first_call, 999)):
            resp = _FakeResponse(data)
            with patch.object(fetch_verified.urllib.request, "urlopen", return_value=resp):
                with self.assertRaises(SystemExit) as ctx:
                    fetch_verified.fetch_verified("https://download.example/m.pth", self.dest, _sha(data), 1024, 10)
        self.assertIn("總時限", str(ctx.exception))
        self.assertFalse(os.path.exists(self.dest))
        self.assertEqual(os.listdir(os.path.dirname(self.dest)), [])

    def test_malformed_expected_hash_is_rejected(self):
        for bad in ("", "abc", "z" * 64):
            with self.assertRaises(SystemExit, msg=bad):
                fetch_verified.fetch_verified("https://download.example/m.pth", self.dest, bad)


if __name__ == "__main__":
    unittest.main()
