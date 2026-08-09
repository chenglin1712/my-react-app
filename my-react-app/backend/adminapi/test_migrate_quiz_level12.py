"""migrate_quiz_level12_to_db 管理指令的 Cloudinary 上傳補償測試。

獨立審查找到的問題：媒體上傳與 DB 建立沒有補償機制——Cloudinary 上傳成功
但這一題整體匯入失敗時（例如同一題的第二個檔案上傳失敗），沒有留下任何
線索，孤兒資產完全無跡可循；且原本每次上傳都是 Cloudinary 隨機檔名，
重跑同一個 origin_key 會產生新的隨機檔名，不會覆蓋/重用先前的上傳。這裡
測試改寫後的行為：(1) 上傳帶固定的 public_id；(2) 部分上傳成功但整題
失敗時，會把已上傳的網址印出來當作孤兒資產線索，且不會建立 DB 列。
"""
from io import StringIO
from unittest.mock import MagicMock, patch

import requests
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from .management.commands.migrate_quiz_level12_to_db import Command, _cloudinary_upload
from .models import QuizTrueFalseItem


def _fake_response(json_data):
    resp = MagicMock()
    resp.raise_for_status.return_value = None
    resp.json.return_value = json_data
    return resp


class CloudinaryUploadTest(TestCase):
    @patch("adminapi.management.commands.migrate_quiz_level12_to_db.requests.post")
    def test_public_id_passed_through_when_given(self, mock_post):
        mock_post.return_value = _fake_response({"secure_url": "https://res.cloudinary.com/x/y.mp3"})

        result = _cloudinary_upload(
            "https://source.example/a.mp3", "video", "quizbank/tayal/true_false",
            "demo-cloud", "demo-preset", public_id="1_8-audio",
        )

        self.assertEqual(result, "https://res.cloudinary.com/x/y.mp3")
        sent_data = mock_post.call_args.kwargs["data"]
        self.assertEqual(sent_data["public_id"], "1_8-audio")

    @patch("adminapi.management.commands.migrate_quiz_level12_to_db.requests.post")
    def test_no_public_id_key_when_not_given(self, mock_post):
        mock_post.return_value = _fake_response({"secure_url": "https://res.cloudinary.com/x/y.mp3"})

        _cloudinary_upload(
            "https://source.example/a.mp3", "video", "quizbank/tayal/true_false",
            "demo-cloud", "demo-preset",
        )

        sent_data = mock_post.call_args.kwargs["data"]
        self.assertNotIn("public_id", sent_data)


class PartialUploadFailureTest(TestCase):
    """驗證 _import_true_false_item()：第一個檔案（音檔）上傳成功、第二個
    （圖片）失敗時，不會建立 DB 列，且會把已上傳的網址記錄成警告，讓管理者
    知道 Cloudinary 上可能留下了一個沒有 DB 資料指向的孤兒檔案。"""

    @patch("adminapi.management.commands.migrate_quiz_level12_to_db._cloudinary_upload")
    def test_second_upload_failure_logs_first_upload_as_orphan_and_creates_no_row(self, mock_upload):
        mock_upload.side_effect = [
            "https://res.cloudinary.com/x/audio-uploaded.mp3",  # 音檔上傳成功
            requests.exceptions.Timeout("cloudinary timed out"),  # 圖片上傳失敗
        ]

        command = Command()
        command.stderr = StringIO()
        command.style = MagicMock()
        command.style.WARNING = lambda msg: msg

        question = {"audio": "https://source.example/a.mp3", "image": "https://source.example/a.png"}
        with self.assertRaises(requests.exceptions.Timeout):
            command._import_true_false_item(
                "tayal", question, 1, "1_8", "demo-cloud", "demo-preset",
            )

        self.assertEqual(QuizTrueFalseItem.objects.count(), 0)
        warning_output = command.stderr.getvalue()
        self.assertIn("1_8", warning_output)
        self.assertIn("https://res.cloudinary.com/x/audio-uploaded.mp3", warning_output)
        self.assertIn("孤兒", warning_output)

    @patch("adminapi.management.commands.migrate_quiz_level12_to_db._cloudinary_upload")
    def test_first_upload_failure_does_not_mention_orphans(self, mock_upload):
        """第一個檔案就失敗時，沒有任何東西上傳成功，不該印出誤導的
        「孤兒資產」警告——這裡驗證只在真的有上傳成功的部分時才提示。"""
        mock_upload.side_effect = requests.exceptions.Timeout("cloudinary timed out")

        command = Command()
        command.stderr = StringIO()
        command.style = MagicMock()
        command.style.WARNING = lambda msg: msg

        question = {"audio": "https://source.example/a.mp3", "image": "https://source.example/a.png"}
        with self.assertRaises(requests.exceptions.Timeout):
            command._import_true_false_item(
                "tayal", question, 1, "1_9", "demo-cloud", "demo-preset",
            )

        self.assertEqual(command.stderr.getvalue(), "")

    @patch("adminapi.management.commands.migrate_quiz_level12_to_db._cloudinary_upload")
    def test_all_uploads_succeed_creates_row_with_deterministic_public_ids(self, mock_upload):
        mock_upload.side_effect = [
            "https://res.cloudinary.com/x/audio.mp3",
            "https://res.cloudinary.com/x/image.png",
        ]

        command = Command()
        question = {"audio": "https://source.example/a.mp3", "image": "https://source.example/a.png"}
        command._import_true_false_item("tayal", question, 1, "1_10", "demo-cloud", "demo-preset")

        item = QuizTrueFalseItem.objects.get(origin_key="1_10")
        self.assertEqual(item.audio_url, "https://res.cloudinary.com/x/audio.mp3")
        self.assertEqual(item.image_url, "https://res.cloudinary.com/x/image.png")

        # public_id 引數確實用 origin_key 為基礎組出來，兩次呼叫各自不同。
        calls = mock_upload.call_args_list
        self.assertEqual(calls[0].kwargs["public_id"], "1_10-audio")
        self.assertEqual(calls[1].kwargs["public_id"], "1_10-image")


class MissingCloudinaryConfigTest(TestCase):
    def test_missing_env_vars_raises_command_error(self):
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(CommandError):
                call_command("migrate_quiz_level12_to_db")
