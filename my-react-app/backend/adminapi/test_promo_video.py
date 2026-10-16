"""S3-1 首頁宣傳影片資料層：模型驗證、媒體路徑與公開網址、後台啟用與公開端點格式。

契約見 HOMEPAGE_CONTRACT.md（第 3.2、4.1、6、7 節）。
"""
import json
import os
import tempfile
from contextlib import contextmanager
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import Client, TestCase
from django.test.utils import override_settings

from adminapi.auth_fixtures import fresh_auth
from config.roles import ADMIN, EDITOR, OWNER

from .models import AuditLog, HomepageConfig, PromoVideo
from .promo_media import media_file_exists, public_media_url

HEX_A = "a" * 32
HEX_B = "b" * 32
VIDEO_PATH = f"homepage/video/{HEX_A}.mp4"
COVER_PATH = f"homepage/cover/{HEX_A}.webp"
CAPTION_PATH = f"homepage/caption/{HEX_A}.vtt"

PUBLIC_URL = "/adminapi/public/homepage-config/"
ADMIN_URL = "/adminapi/homepage-config/"

# 契約 4.1：既有鍵一個都不能少、不能改名
LEGACY_PUBLIC_KEYS = {
    "hero_image_url", "hero_link_url", "hero_title_override",
    "show_news_section", "show_calendar_section", "news_display_count",
    "button1_enabled", "button2_enabled", "button3_enabled",
}


@contextmanager
def _as_role(role):
    """跟 test_feature_flags.py 的 _as_role 一樣：關掉 AUTH_DEV_BYPASS，mock verify_id_token。"""
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": "test-uid"}
            if role is not None:
                decoded["role"] = role
            with patch("firebase_admin.auth.verify_id_token", return_value=fresh_auth(decoded)):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _patch_json(client, url, headers, payload):
    return client.patch(url, data=json.dumps(payload), content_type="application/json", **headers)


def _write_media(root, rel_path, data=b"x"):
    full = os.path.join(root, *rel_path.split("/"))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "wb") as fh:
        fh.write(data)
    return full


class MediaRootMixin:
    """每個測試用獨立的暫存媒體根目錄，不碰真正的 media/。"""

    def setUp(self):
        super().setUp()
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.media_root = self._tmp.name
        override = override_settings(MEDIA_ROOT=self.media_root)
        override.enable()
        self.addCleanup(override.disable)


class PromoVideoValidationTest(TestCase):
    def _video(self, **kwargs):
        data = {"title": "介紹影片"}
        data.update(kwargs)
        return PromoVideo(**data)

    def test_valid_paths_pass(self):
        video = self._video(video_path=VIDEO_PATH, cover_path=COVER_PATH, caption_path=CAPTION_PATH)
        video.full_clean()
        video.cover_path = f"homepage/cover/{HEX_B}.jpg"
        video.full_clean()

    def test_all_paths_may_be_blank(self):
        self._video().full_clean()

    def test_rejects_external_and_unsafe_video_paths(self):
        bad = [
            "https://example.com/a.mp4",
            "//example.com/a.mp4",
            "/homepage/video/" + HEX_A + ".mp4",
            "homepage/video/../../etc/passwd",
            "homepage/video/" + HEX_A + ".mp4/../x",
            "homepage\\video\\" + HEX_A + ".mp4",
            "homepage/video/" + HEX_A + ".mp4\n",
            "homepage/video/" + HEX_A + ".mp4\x00",
            "homepage/video/" + HEX_A.upper() + ".mp4",
            "homepage/video/" + "a" * 31 + ".mp4",
            "homepage/video/" + HEX_A + ".webm",
            "homepage/cover/" + HEX_A + ".mp4",
            "javascript:alert(1)",
        ]
        for value in bad:
            with self.subTest(value=value):
                with self.assertRaises(ValidationError):
                    self._video(video_path=value).full_clean()

    def test_cover_and_caption_only_accept_their_own_directory_and_extension(self):
        for kwargs in (
            {"cover_path": f"homepage/cover/{HEX_A}.svg"},
            {"cover_path": f"homepage/cover/{HEX_A}.png"},
            {"cover_path": f"homepage/video/{HEX_A}.jpg"},
            {"caption_path": f"homepage/caption/{HEX_A}.srt"},
            {"caption_path": f"homepage/cover/{HEX_A}.vtt"},
        ):
            with self.subTest(**kwargs):
                with self.assertRaises(ValidationError):
                    self._video(**kwargs).full_clean()

    def test_title_is_required_single_line_and_max_60(self):
        for title in ("", "   ", "\u3000\u3000", "第一行\n第二行", "含\x00空位元組", "字" * 61):
            with self.subTest(title=title):
                with self.assertRaises(ValidationError):
                    self._video(title=title).full_clean()
        self._video(title="字" * 60).full_clean()

    def test_description_and_transcript_limits_and_control_characters(self):
        self._video(description="第一行\n第二行", transcript="第一段\n\n第二段\t縮排").full_clean()
        for kwargs in (
            {"description": "字" * 301},
            {"description": "含\x00"},
            {"transcript": "字" * 6001},
            {"transcript": "含\x00"},
            {"transcript": "含\x1b跳脫"},
        ):
            with self.subTest(**{k: v[:10] for k, v in kwargs.items()}):
                with self.assertRaises(ValidationError):
                    self._video(**kwargs).full_clean()
        self._video(transcript="字" * 6000).full_clean()


    def test_duration_and_size_bounds_follow_the_contract(self):
        self._video(duration_seconds=480, size_bytes=150 * 1024 * 1024).full_clean()
        self._video(duration_seconds=None, size_bytes=None).full_clean()
        for kwargs in (
            {"duration_seconds": 0},
            {"duration_seconds": 481},
            {"size_bytes": 0},
            {"size_bytes": 150 * 1024 * 1024 + 1},
        ):
            with self.subTest(**kwargs):
                with self.assertRaises(ValidationError):
                    self._video(**kwargs).full_clean()


class PromoMediaHelperTest(MediaRootMixin, TestCase):
    def test_blank_and_missing_paths_have_no_url(self):
        self.assertIsNone(public_media_url(""))
        self.assertIsNone(public_media_url(VIDEO_PATH))
        self.assertFalse(media_file_exists(VIDEO_PATH))

    def test_existing_file_gets_same_origin_relative_url(self):
        _write_media(self.media_root, VIDEO_PATH)
        self.assertTrue(media_file_exists(VIDEO_PATH))
        self.assertEqual(public_media_url(VIDEO_PATH), "/media/" + VIDEO_PATH)

    def test_directory_is_not_a_file(self):
        os.makedirs(os.path.join(self.media_root, "homepage", "video", "dir"))
        self.assertFalse(media_file_exists("homepage/video/dir"))

    def test_path_escaping_media_root_is_rejected_even_if_file_exists(self):
        outside = tempfile.TemporaryDirectory()
        self.addCleanup(outside.cleanup)
        _write_media(outside.name, "secret.txt")
        rel = os.path.relpath(os.path.join(outside.name, "secret.txt"), self.media_root).replace(os.sep, "/")
        self.assertFalse(media_file_exists(rel))
        self.assertIsNone(public_media_url(rel))

    def test_dot_segments_are_rejected_outright(self):
        _write_media(self.media_root, "homepage/video/ok.mp4")
        for value in ("homepage/video/../video/ok.mp4", "./homepage/video/ok.mp4", "homepage//video/ok.mp4"):
            with self.subTest(value=value):
                self.assertFalse(media_file_exists(value))

    def test_commonpath_errors_fail_closed(self):
        # Windows 跨磁碟機時 commonpath 會丟 ValueError；公開端點不能因此 500。
        _write_media(self.media_root, VIDEO_PATH)
        with patch("adminapi.promo_media.os.path.commonpath", side_effect=ValueError("different drives")):
            self.assertIsNone(public_media_url(VIDEO_PATH))

    def test_symlinked_parent_directory_is_rejected(self):
        # 不依賴作業系統能不能建符號連結：直接讓某一層父目錄「看起來是」符號連結。
        _write_media(self.media_root, VIDEO_PATH)
        parent = os.path.join(os.path.realpath(self.media_root), "homepage", "video")
        real_islink = os.path.islink
        with patch("adminapi.promo_media.os.path.islink", side_effect=lambda p: p == parent or real_islink(p)):
            self.assertIsNone(public_media_url(VIDEO_PATH))
        self.assertEqual(public_media_url(VIDEO_PATH), "/media/" + VIDEO_PATH)

    def test_symlink_is_not_followed(self):
        target = _write_media(self.media_root, "real/file.mp4")
        link_dir = os.path.join(self.media_root, "homepage", "video")
        os.makedirs(link_dir)
        link = os.path.join(link_dir, f"{HEX_A}.mp4")
        try:
            os.symlink(target, link)
        except (OSError, NotImplementedError):
            self.skipTest("這個環境不能建立符號連結")
        self.assertIsNone(public_media_url(VIDEO_PATH))


class HomepageConfigPromoVideoAdminTest(MediaRootMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client = Client()
        self.with_file = PromoVideo.objects.create(title="有檔案", video_path=VIDEO_PATH)
        self.without_file = PromoVideo.objects.create(title="還沒上傳影片檔")

    def test_default_has_no_active_video(self):
        with _as_role(OWNER) as headers:
            data = self.client.get(ADMIN_URL, **headers).json()
        self.assertIn("active_promo_video", data)
        self.assertIsNone(data["active_promo_video"])

    def test_owner_can_activate_and_audit_log_records_before_and_after(self):
        with _as_role(OWNER) as headers:
            response = _patch_json(self.client, ADMIN_URL, headers, {"active_promo_video": self.with_file.pk})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["active_promo_video"], self.with_file.pk)
        self.assertEqual(HomepageConfig.load().active_promo_video_id, self.with_file.pk)
        log = AuditLog.objects.filter(target_type="homepage_config", action="update").latest("pk")
        self.assertIsNone(log.before["active_promo_video"])
        self.assertEqual(log.after["active_promo_video"], self.with_file.pk)

    def test_admin_can_deactivate_by_setting_null(self):
        config = HomepageConfig.load()
        config.active_promo_video = self.with_file
        config.save()
        with _as_role(ADMIN) as headers:
            response = _patch_json(self.client, ADMIN_URL, headers, {"active_promo_video": None})
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(HomepageConfig.load().active_promo_video_id)

    def test_cannot_activate_video_without_video_file(self):
        with _as_role(OWNER) as headers:
            response = _patch_json(self.client, ADMIN_URL, headers, {"active_promo_video": self.without_file.pk})
        self.assertEqual(response.status_code, 400)
        self.assertIn("active_promo_video", response.json()["errors"])
        self.assertIsNone(HomepageConfig.load().active_promo_video_id)

    def test_cannot_activate_nonexistent_video(self):
        with _as_role(OWNER) as headers:
            response = _patch_json(self.client, ADMIN_URL, headers, {"active_promo_video": 999999})
        self.assertEqual(response.status_code, 400)

    def test_malformed_active_video_values_are_400_not_500(self):
        for value in (True, "abc", [1], {"id": 1}, 1.5, -1):
            with self.subTest(value=value):
                with _as_role(OWNER) as headers:
                    response = _patch_json(self.client, ADMIN_URL, headers, {"active_promo_video": value})
                self.assertEqual(response.status_code, 400)
        self.assertIsNone(HomepageConfig.load().active_promo_video_id)

    def test_editor_cannot_activate(self):
        with _as_role(EDITOR) as headers:
            response = _patch_json(self.client, ADMIN_URL, headers, {"active_promo_video": self.with_file.pk})
        self.assertEqual(response.status_code, 403)
        self.assertIsNone(HomepageConfig.load().active_promo_video_id)

    def test_other_fields_still_patch_without_touching_active_video(self):
        config = HomepageConfig.load()
        config.active_promo_video = self.with_file
        config.save()
        with _as_role(OWNER) as headers:
            response = _patch_json(self.client, ADMIN_URL, headers, {"show_news_section": False})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(HomepageConfig.load().active_promo_video_id, self.with_file.pk)

    def test_deleting_the_video_clears_the_active_reference(self):
        config = HomepageConfig.load()
        config.active_promo_video = self.with_file
        config.save()
        self.with_file.delete()
        self.assertIsNone(HomepageConfig.load().active_promo_video_id)
        self.assertIsNone(self.client.get(PUBLIC_URL).json()["promo_video"])


class PublicHomepageConfigPromoVideoTest(MediaRootMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client = Client()

    def _activate(self, **fields):
        video = PromoVideo.objects.create(
            title="標題", description="說明", transcript="逐字稿內容", duration_seconds=412,
            size_bytes=1234, created_by="uid-secret", **fields,
        )
        config = HomepageConfig.load()
        config.active_promo_video = video
        config.save()
        return video

    def test_default_keeps_every_legacy_key_and_promo_video_is_null(self):
        response = self.client.get(PUBLIC_URL)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(LEGACY_PUBLIC_KEYS.issubset(data.keys()))
        # S3-2 之後多了報頭與跑馬燈欄位（見 test_homepage_masthead.py），這裡只關心影片相關的鍵
        self.assertTrue((LEGACY_PUBLIC_KEYS | {"promo_video"}).issubset(data.keys()))
        self.assertIsNone(data["promo_video"])

    def test_response_must_be_revalidated(self):
        self.assertEqual(self.client.get(PUBLIC_URL)["Cache-Control"], "no-cache")

    def test_active_video_with_all_files(self):
        _write_media(self.media_root, VIDEO_PATH)
        _write_media(self.media_root, COVER_PATH)
        _write_media(self.media_root, CAPTION_PATH)
        video = self._activate(video_path=VIDEO_PATH, cover_path=COVER_PATH, caption_path=CAPTION_PATH)
        data = self.client.get(PUBLIC_URL).json()["promo_video"]
        self.assertEqual(data, {
            "id": video.pk, "title": "標題", "description": "說明",
            "video_url": "/media/" + VIDEO_PATH,
            "cover_url": "/media/" + COVER_PATH,
            "caption_url": "/media/" + CAPTION_PATH,
            "transcript": "逐字稿內容", "duration_seconds": 412, "available": True,
        })

    def test_urls_are_same_origin_relative_paths(self):
        _write_media(self.media_root, VIDEO_PATH)
        self._activate(video_path=VIDEO_PATH)
        data = self.client.get(PUBLIC_URL).json()["promo_video"]
        self.assertTrue(data["video_url"].startswith("/media/"))
        self.assertFalse(data["video_url"].startswith("//"))
        self.assertNotIn("://", data["video_url"])

    def test_caption_is_optional(self):
        _write_media(self.media_root, VIDEO_PATH)
        self._activate(video_path=VIDEO_PATH)
        data = self.client.get(PUBLIC_URL).json()["promo_video"]
        self.assertTrue(data["available"])
        self.assertIsNone(data["caption_url"])
        self.assertIsNone(data["cover_url"])

    def test_missing_video_file_keeps_object_with_transcript_but_not_available(self):
        _write_media(self.media_root, COVER_PATH)
        self._activate(video_path=VIDEO_PATH, cover_path=COVER_PATH)  # 影片檔沒寫進磁碟
        data = self.client.get(PUBLIC_URL).json()["promo_video"]
        self.assertIsNotNone(data)
        self.assertFalse(data["available"])
        self.assertIsNone(data["video_url"])
        self.assertEqual(data["cover_url"], "/media/" + COVER_PATH)
        self.assertEqual(data["transcript"], "逐字稿內容")

    def test_missing_cover_file_does_not_make_video_unavailable(self):
        _write_media(self.media_root, VIDEO_PATH)
        self._activate(video_path=VIDEO_PATH, cover_path=COVER_PATH)  # 封面檔沒寫進磁碟
        data = self.client.get(PUBLIC_URL).json()["promo_video"]
        self.assertTrue(data["available"])
        self.assertIsNone(data["cover_url"])

    def test_internal_fields_are_not_exposed(self):
        _write_media(self.media_root, VIDEO_PATH)
        self._activate(video_path=VIDEO_PATH)
        data = self.client.get(PUBLIC_URL).json()["promo_video"]
        for key in ("created_by", "created_at", "updated_at", "size_bytes", "video_path", "cover_path", "caption_path"):
            self.assertNotIn(key, data)
        self.assertNotIn("uid-secret", json.dumps(data))
