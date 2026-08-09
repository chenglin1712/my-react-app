"""firebase_ops.delete_storage_file_by_download_url() 的直接單元測試。

之前這支函式只在呼叫端測試（test_moderation.py／test_users.py）裡被整個
mock 掉，從未真正測過自己的網址解析／驗證邏輯。這次補上安全性驗證
（scheme／hostname／bucket／expected_path_prefix）後，這裡直接測函式本身，
只 mock get_storage_bucket()，讓解析與驗證邏輯真的被執行到。
"""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import firebase_ops


def _fake_bucket(name="yuanyu-app.appspot.com"):
    bucket = MagicMock()
    bucket.name = name
    return bucket


class DeleteStorageFileByDownloadUrlTest(SimpleTestCase):
    VALID_URL = (
        "https://firebasestorage.googleapis.com/v0/b/yuanyu-app.appspot.com/o/"
        "pronunciations%2Ftayal%2Fabas%2F123_uid1.webm?alt=media&token=abc"
    )

    @patch("adminapi.firebase_ops.get_storage_bucket")
    def test_valid_url_within_expected_prefix_deletes_successfully(self, mock_get_bucket):
        bucket = _fake_bucket()
        mock_get_bucket.return_value = bucket

        result = firebase_ops.delete_storage_file_by_download_url(
            self.VALID_URL, expected_path_prefix="pronunciations/tayal/",
        )

        self.assertTrue(result)
        bucket.blob.assert_called_once_with("pronunciations/tayal/abas/123_uid1.webm")
        bucket.blob.return_value.delete.assert_called_once()

    @patch("adminapi.firebase_ops.get_storage_bucket")
    def test_path_outside_expected_prefix_rejected_without_deleting(self, mock_get_bucket):
        """惡意使用者偽造的 storageUrl 指向別的 tribe（或別的物件），跟呼叫端
        依真實路徑組出的 expected_path_prefix 不符——這是修正的核心案例。"""
        bucket = _fake_bucket()
        mock_get_bucket.return_value = bucket

        result = firebase_ops.delete_storage_file_by_download_url(
            self.VALID_URL, expected_path_prefix="pronunciations/amis/",
        )

        self.assertFalse(result)
        bucket.blob.assert_not_called()

    @patch("adminapi.firebase_ops.get_storage_bucket")
    def test_url_pointing_outside_pronunciations_entirely_rejected(self, mock_get_bucket):
        """偽造網址指向完全不相干的物件（例如辭典媒體），不應該被刪除。"""
        bucket = _fake_bucket()
        mock_get_bucket.return_value = bucket
        malicious_url = (
            "https://firebasestorage.googleapis.com/v0/b/yuanyu-app.appspot.com/o/"
            "dictionary_media%2Fimportant_word_audio.mp3?alt=media"
        )

        result = firebase_ops.delete_storage_file_by_download_url(
            malicious_url, expected_path_prefix="pronunciations/tayal/",
        )

        self.assertFalse(result)
        bucket.blob.assert_not_called()

    @patch("adminapi.firebase_ops.get_storage_bucket")
    def test_wrong_bucket_name_rejected(self, mock_get_bucket):
        bucket = _fake_bucket(name="yuanyu-app.appspot.com")
        mock_get_bucket.return_value = bucket
        other_bucket_url = self.VALID_URL.replace("yuanyu-app.appspot.com", "attacker-bucket.appspot.com")

        result = firebase_ops.delete_storage_file_by_download_url(other_bucket_url)

        self.assertFalse(result)
        bucket.blob.assert_not_called()

    @patch("adminapi.firebase_ops.get_storage_bucket")
    def test_non_https_scheme_rejected(self, mock_get_bucket):
        bucket = _fake_bucket()
        mock_get_bucket.return_value = bucket
        http_url = self.VALID_URL.replace("https://", "http://")

        result = firebase_ops.delete_storage_file_by_download_url(http_url)

        self.assertFalse(result)
        bucket.blob.assert_not_called()

    @patch("adminapi.firebase_ops.get_storage_bucket")
    def test_non_firebase_storage_hostname_rejected(self, mock_get_bucket):
        bucket = _fake_bucket()
        mock_get_bucket.return_value = bucket
        fake_host_url = self.VALID_URL.replace(
            "firebasestorage.googleapis.com", "evil.example.com",
        )

        result = firebase_ops.delete_storage_file_by_download_url(fake_host_url)

        self.assertFalse(result)
        bucket.blob.assert_not_called()

    @patch("adminapi.firebase_ops.get_storage_bucket")
    def test_malformed_url_without_o_segment_rejected(self, mock_get_bucket):
        bucket = _fake_bucket()
        mock_get_bucket.return_value = bucket

        result = firebase_ops.delete_storage_file_by_download_url(
            "https://firebasestorage.googleapis.com/v0/b/yuanyu-app.appspot.com/not-o-segment",
        )

        self.assertFalse(result)
        bucket.blob.assert_not_called()

    @patch("adminapi.firebase_ops.get_storage_bucket")
    def test_no_expected_prefix_allows_any_path_in_same_bucket(self, mock_get_bucket):
        """expected_path_prefix 是選填的——沒有帶的呼叫端（如果未來有）仍然只
        受 scheme/hostname/bucket 三項防線保護，不強制要求 prefix。"""
        bucket = _fake_bucket()
        mock_get_bucket.return_value = bucket

        result = firebase_ops.delete_storage_file_by_download_url(self.VALID_URL)

        self.assertTrue(result)
        bucket.blob.assert_called_once_with("pronunciations/tayal/abas/123_uid1.webm")

    @patch("adminapi.firebase_ops.get_storage_bucket")
    def test_blob_delete_exception_returns_false(self, mock_get_bucket):
        bucket = _fake_bucket()
        bucket.blob.return_value.delete.side_effect = Exception("not found")
        mock_get_bucket.return_value = bucket

        result = firebase_ops.delete_storage_file_by_download_url(
            self.VALID_URL, expected_path_prefix="pronunciations/tayal/",
        )

        self.assertFalse(result)
