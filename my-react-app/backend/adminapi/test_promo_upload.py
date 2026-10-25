"""S3-4 宣傳影片上傳與送檔：檢查規格、暫存與原子提交、替換與延遲清理、角色、遺失告警。

真實影片用 ffmpeg 現場產生極小的檔案；機器上沒有 ffmpeg 時，需要真實檔案的測試會略過，
但用字典餵 analyze_probe 的規格檢查與 MP4 box 解析（合成位元組）仍會執行。
"""
import io
import json
import os
import shutil
import struct
import subprocess
import tempfile
import time
import unittest
from contextlib import contextmanager
from unittest.mock import patch

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import Client, TestCase
from django.test.utils import override_settings
from django.utils import timezone

from adminapi import promo_upload as upload
from adminapi.auth_fixtures import fresh_auth
from adminapi.promo_media import media_file_exists, public_media_url
from config.roles import ADMIN, ANALYST, EDITOR, OWNER

from .models import AuditLog, HomepageConfig, PromoMediaOrphan, PromoVideo

URL = "/adminapi/promo-videos/"
PUBLIC_CONFIG = "/adminapi/public/homepage-config/"
HAS_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))

skip_no_ffmpeg = unittest.skipUnless(HAS_FFMPEG, "需要 ffmpeg 與 ffprobe")
_fixture_dir = None
_fixtures = {}


def setUpModule():
    global _fixture_dir
    _fixture_dir = tempfile.mkdtemp(prefix="promo-fixtures-")
    if not HAS_FFMPEG:
        return

    def make(name, *extra, video="libx264", pix="yuv420p", size="160x120", audio=True, duration=2):
        path = os.path.join(_fixture_dir, name)
        cmd = ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"testsrc=size={size}:rate=10:duration={duration}"]
        if audio:
            cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={duration}"]
        cmd += ["-c:v", video, "-pix_fmt", pix]
        if audio:
            cmd += ["-c:a", "aac"]
        cmd += list(extra) + [path]
        subprocess.run(cmd, check=True, capture_output=True)
        _fixtures[name] = path

    make("fast.mp4", "-movflags", "+faststart")
    make("slow.mp4")  # moov 在檔尾
    make("silent.mp4", "-movflags", "+faststart", audio=False)
    make("wide.mp4", "-movflags", "+faststart", size="2000x100")
    make("yuv444.mp4", "-movflags", "+faststart", pix="yuv444p")
    try:
        make("mpeg4.mp4", "-movflags", "+faststart", video="mpeg4")
    except subprocess.CalledProcessError:
        pass


def tearDownModule():
    shutil.rmtree(_fixture_dir, ignore_errors=True)


def fixture_bytes(name):
    with open(_fixtures[name], "rb") as f:
        return f.read()


def jpeg_bytes(size=(64, 48), exif=False):
    from PIL import Image
    buf = io.BytesIO()
    img = Image.new("RGB", size, (200, 30, 30))
    if exif:
        e = Image.Exif()
        e[0x010F] = "SecretCameraMaker"
        img.save(buf, "JPEG", exif=e)
    else:
        img.save(buf, "JPEG")
    return buf.getvalue()


def webp_bytes(size=(64, 48)):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", size, (30, 30, 200)).save(buf, "WEBP")
    return buf.getvalue()


def box(box_type, payload=b""):
    return struct.pack(">I4s", 8 + len(payload), box_type) + payload


VTT = "WEBVTT\n\n00:00.000 --> 00:02.000\n字幕一行\n"


@contextmanager
def _as_role(role, uid="test-uid"):
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": uid}
            if role is not None:
                decoded["role"] = role
            with patch("firebase_admin.auth.verify_id_token", return_value=fresh_auth(decoded)):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


class MediaTestCase(TestCase):
    """每個測試用獨立的暫存媒體根目錄，不碰真正的 media/。"""

    def setUp(self):
        super().setUp()
        cache.clear()
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.media_root = self._tmp.name
        override = override_settings(MEDIA_ROOT=self.media_root, MEDIA_STAGING_ROOT=None)
        override.enable()
        self.addCleanup(override.disable)
        self.client = Client()

    def staging_files(self):
        directory = upload.staging_root()
        return os.listdir(directory) if os.path.isdir(directory) else []

    def abs_path(self, relative):
        return os.path.join(self.media_root, *relative.split("/"))


# ------------------------------------------------------------------ 純邏輯


class MP4BoxTest(TestCase):
    def _write(self, data):
        f = tempfile.NamedTemporaryFile(delete=False)
        f.write(data)
        f.close()
        self.addCleanup(os.remove, f.name)
        return f.name

    def test_moov_before_mdat_passes(self):
        upload.check_faststart(self._write(box(b"ftyp", b"isom") + box(b"moov", b"x" * 8) + box(b"mdat", b"y" * 8)))

    def test_moov_after_mdat_gives_actionable_message(self):
        path = self._write(box(b"ftyp", b"isom") + box(b"mdat", b"y" * 8) + box(b"moov", b"x" * 8))
        with self.assertRaises(upload.PromoUploadError) as ctx:
            upload.check_faststart(path)
        self.assertIn("-movflags +faststart", ctx.exception.message)

    def test_structure_errors(self):
        cases = {
            "沒有 ftyp": box(b"moov") + box(b"mdat"),
            "沒有 moov": box(b"ftyp", b"isom") + box(b"mdat"),
            "截斷": box(b"ftyp", b"isom") + struct.pack(">I4s", 9999, b"mdat"),
            "大小小於標頭": box(b"ftyp", b"isom") + struct.pack(">I4s", 3, b"moov"),
            "太短": b"abc",
        }
        for name, data in cases.items():
            with self.subTest(case=name):
                with self.assertRaises(upload.PromoUploadError):
                    upload.check_faststart(self._write(data))

    def test_64bit_size_box_is_parsed(self):
        mdat = struct.pack(">I4sQ", 1, b"mdat", 16 + 4) + b"abcd"
        upload.check_faststart(self._write(box(b"ftyp", b"isom") + box(b"moov", b"x" * 8) + mdat))


def _probe(**overrides):
    probe = {
        "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "10.5"},
        "streams": [
            {"codec_type": "video", "codec_name": "h264", "pix_fmt": "yuv420p", "width": 1280, "height": 720},
            {"codec_type": "audio", "codec_name": "aac"},
        ],
    }
    probe.update(overrides)
    return probe


class AnalyzeProbeTest(TestCase):
    def test_valid_probe(self):
        duration, info = upload.analyze_probe(_probe())
        self.assertEqual(duration, 11)  # 向上取整
        self.assertEqual((info["width"], info["has_audio"]), (1280, True))

    def test_video_without_audio_is_allowed(self):
        probe = _probe(streams=[_probe()["streams"][0]])
        self.assertFalse(upload.analyze_probe(probe)[1]["has_audio"])

    def test_extra_streams_are_rejected_with_a_remux_command(self):
        extras = [
            {"codec_type": "video", "codec_name": "mjpeg", "disposition": {"attached_pic": 1}},
            {"codec_type": "data", "codec_name": "none"},
            {"codec_type": "subtitle", "codec_name": "mov_text"},
            {"codec_type": "attachment", "codec_name": "ttf"},
        ]
        for extra in extras:
            with self.subTest(codec_type=extra["codec_type"]):
                with self.assertRaises(upload.PromoUploadError) as ctx:
                    upload.analyze_probe(_probe(streams=_probe()["streams"] + [extra]))
                self.assertIn("-map 0:v:0 -map 0:a:0?", ctx.exception.message)

    def test_rejections(self):
        v = _probe()["streams"][0]
        a = _probe()["streams"][1]
        cases = {
            "webm": _probe(format={"format_name": "matroska,webm", "duration": "10"}),
            "no video": _probe(streams=[a]),
            "two video": _probe(streams=[v, dict(v)]),
            "two audio": _probe(streams=[v, a, dict(a)]),
            "hevc": _probe(streams=[dict(v, codec_name="hevc"), a]),
            "yuv444": _probe(streams=[dict(v, pix_fmt="yuv444p"), a]),
            "10bit": _probe(streams=[dict(v, pix_fmt="yuv420p10le"), a]),
            "too wide": _probe(streams=[dict(v, width=1921), a]),
            "too tall": _probe(streams=[dict(v, height=5000), a]),
            "mp3 audio": _probe(streams=[v, dict(a, codec_name="mp3")]),
            "too long": _probe(format={"format_name": "mov,mp4", "duration": "480.5"}),
            "zero duration": _probe(format={"format_name": "mov,mp4", "duration": "0"}),
            "no duration": _probe(format={"format_name": "mov,mp4"}),
            "nan duration": _probe(format={"format_name": "mov,mp4", "duration": "abc"}),
        }
        for name, probe in cases.items():
            with self.subTest(case=name):
                with self.assertRaises(upload.PromoUploadError):
                    upload.analyze_probe(probe)

    def test_exactly_eight_minutes_is_allowed_and_message_is_actionable(self):
        upload.analyze_probe(_probe(format={"format_name": "mov,mp4", "duration": "480.0"}))
        with self.assertRaises(upload.PromoUploadError) as ctx:
            upload.analyze_probe(_probe(format={"format_name": "mov,mp4", "duration": "600"}))
        self.assertIn("剪短", ctx.exception.message)
        v = _probe()["streams"][0]
        with self.assertRaises(upload.PromoUploadError) as ctx:
            upload.analyze_probe(_probe(streams=[dict(v, codec_name="hevc")]))
        self.assertIn("libx264", ctx.exception.message)


class FfprobeHardeningTest(TestCase):
    def test_command_restricts_protocols_and_never_reads_stdin(self):
        command = upload._ffprobe_command("ffprobe", "/tmp/x.part")
        self.assertNotIn("-nostdin", command)  # 這是 ffmpeg 的選項，ffprobe 不認得
        index = command.index("-protocol_whitelist")
        self.assertEqual(command[index + 1], "file")
        self.assertEqual(command[-2:], ["-i", "/tmp/x.part"])  # 檔名跟在 -i 後面，不會被當成選項

    def test_resource_limits_are_applied_before_exec(self):
        import sys
        import types
        calls = []
        fake = types.SimpleNamespace(
            RLIMIT_CPU="cpu", RLIMIT_AS="as", RLIMIT_FSIZE="fsize",
            setrlimit=lambda which, limits: calls.append((which, limits)),
        )
        with patch.dict(sys.modules, {"resource": fake}):
            upload._limit_resources()
        limits = dict(calls)
        self.assertEqual(limits["cpu"], (upload.FFPROBE_TIMEOUT_SECONDS,) * 2)
        self.assertEqual(limits["as"], (upload.FFPROBE_MAX_ADDRESS_SPACE,) * 2)
        self.assertEqual(limits["fsize"], (0, 0))

    @patch("adminapi.promo_upload.subprocess.run")
    def test_stdin_is_closed_and_errors_never_leak_ffprobe_output_to_the_user(self, run):
        run.return_value = subprocess.CompletedProcess([], 1, b"", b"/srv/secret/path ffprobe version 6.1 error")
        with self.assertLogs("adminapi.promo_upload", level="WARNING"):
            with self.assertRaises(upload.PromoUploadError) as ctx:
                upload._run_ffprobe("x")
        self.assertEqual(run.call_args.kwargs["stdin"], subprocess.DEVNULL)
        self.assertNotIn("secret", ctx.exception.message)
        self.assertNotIn("version", ctx.exception.message)

    @skip_no_ffmpeg
    def test_real_ffprobe_accepts_the_restricted_command_line(self):
        probe = upload._run_ffprobe(_fixtures["fast.mp4"])
        self.assertIn("mp4", probe["format"]["format_name"])


class DiskSpaceTest(MediaTestCase):
    def test_low_disk_space_is_refused_before_anything_is_written(self):
        usage = shutil._ntuple_diskusage(100, 99, 1)
        with patch("adminapi.promo_upload.shutil.disk_usage", return_value=usage):
            with self.assertLogs("adminapi.promo_upload", level="ERROR"):
                with self.assertRaises(upload.PromoUploadError) as ctx:
                    upload.ensure_free_disk(1000)
        self.assertEqual(ctx.exception.status, 507)

    def test_enough_space_passes(self):
        upload.ensure_free_disk(10)


class FfprobeAvailabilityTest(TestCase):
    def test_missing_ffprobe_is_a_clear_503(self):
        with override_settings(FFPROBE_BIN="definitely-not-installed-ffprobe"):
            with self.assertRaises(upload.PromoUploadError) as ctx:
                upload._run_ffprobe("whatever")
        self.assertEqual(ctx.exception.status, 503)

    @patch("adminapi.promo_upload.subprocess.run")
    def test_timeout_and_failure_and_garbage_output(self, run):
        run.side_effect = subprocess.TimeoutExpired("ffprobe", 20)
        with self.assertRaises(upload.PromoUploadError):
            upload._run_ffprobe("x")
        run.side_effect = None
        run.return_value = subprocess.CompletedProcess([], 1, b"", b"error")
        with self.assertRaises(upload.PromoUploadError):
            upload._run_ffprobe("x")
        run.return_value = subprocess.CompletedProcess([], 0, b"not json", b"")
        with self.assertRaises(upload.PromoUploadError):
            upload._run_ffprobe("x")


class CoverAndCaptionValidationTest(MediaTestCase):
    def _stage(self, data):
        os.makedirs(upload.staging_root(), exist_ok=True)
        path = os.path.join(upload.staging_root(), "in.part")
        with open(path, "wb") as f:
            f.write(data)
        return path

    def test_jpeg_and_webp_are_accepted_and_reencoded(self):
        for data, ext in ((jpeg_bytes(), "jpg"), (webp_bytes(), "webp")):
            out, got_ext = upload.validate_and_reencode_cover(self._stage(data))
            self.assertEqual(got_ext, ext)
            self.assertTrue(os.path.isfile(out))

    def test_exif_is_stripped_and_trailing_data_dropped(self):
        original = jpeg_bytes(exif=True) + b"<script>alert(1)</script>"
        self.assertIn(b"SecretCameraMaker", original)
        out, _ = upload.validate_and_reencode_cover(self._stage(original))
        with open(out, "rb") as f:
            result = f.read()
        self.assertNotIn(b"SecretCameraMaker", result)
        self.assertNotIn(b"<script>", result)

    def test_rejections(self):
        from PIL import Image
        png = io.BytesIO()
        Image.new("RGB", (8, 8)).save(png, "PNG")
        gif = io.BytesIO()
        Image.new("RGB", (8, 8)).save(gif, "GIF")
        cases = {
            "png": png.getvalue(),
            "gif": gif.getvalue(),
            "svg": b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            "html": b"<html><script>alert(1)</script></html>",
            "garbage": b"\x00\x01\x02not an image",
            "truncated jpeg": jpeg_bytes()[:40],
            "too large side": jpeg_bytes(size=(upload.MAX_COVER_SIDE + 1, 8)),
        }
        for name, data in cases.items():
            with self.subTest(case=name):
                with self.assertRaises(upload.PromoUploadError):
                    upload.validate_and_reencode_cover(self._stage(data))

    def test_caption_valid_is_normalized(self):
        path = self._stage(("﻿" + VTT.replace("\n", "\r\n")).encode("utf-8"))
        out, ext = upload.validate_and_normalize_caption(path)
        self.assertEqual(ext, "vtt")
        with open(out, "rb") as f:
            data = f.read()
        self.assertTrue(data.startswith(b"WEBVTT"))
        self.assertNotIn(b"\r", data)
        self.assertNotIn(b"\xef\xbb\xbf", data)

    def test_caption_rejections(self):
        cases = {
            "not vtt": "1\n00:00:00,000 --> 00:00:02,000\n字幕".encode("utf-8"),
            "no cue": b"WEBVTT\n\nNOTE only a note\n",
            "empty header": b"",
            "big5": VTT.encode("big5"),
            "nul": VTT.encode("utf-8") + b"\x00",
            "header glued": b"WEBVTTX\n\n00:00.000 --> 00:02.000\nhi\n",
            "too big": b"WEBVTT\n\n00:00.000 --> 00:02.000\n" + b"a" * (upload.MAX_CAPTION_BYTES + 1),
        }
        for name, data in cases.items():
            with self.subTest(case=name):
                with self.assertRaises(upload.PromoUploadError):
                    upload.validate_and_normalize_caption(self._stage(data))

    def test_caption_header_with_trailing_text_is_allowed(self):
        upload.validate_and_normalize_caption(self._stage(b"WEBVTT - title\n\n00:00:01.000 --> 00:00:02.000\nhi\n"))


# ------------------------------------------------------------------ API


class ApiBase(MediaTestCase):
    def call(self, method, path, payload=None, role=OWNER, uid="test-uid", **extra):
        with _as_role(role, uid) as headers:
            fn = getattr(self.client, method)
            if payload is None:
                return fn(path, **headers, **extra)
            return fn(path, data=json.dumps(payload), content_type="application/json", **headers)

    def create(self, **kwargs):
        response = self.call("post", URL, dict({"title": "介紹影片"}, **kwargs))
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["id"]

    def post_file(self, pk, kind, data, name="x", role=OWNER, content_type="application/octet-stream"):
        with _as_role(role) as headers:
            return self.client.post(
                f"{URL}{pk}/{kind}/", {"file": SimpleUploadedFile(name, data, content_type=content_type)}, **headers)


class CrudAndRolesTest(ApiBase):
    def test_create_list_get_update(self):
        pk = self.create(description="說明", transcript="逐字稿")
        data = self.call("get", f"{URL}{pk}/", role=ANALYST).json()
        self.assertEqual((data["title"], data["video_path"], data["is_active"], data["video_url"]), ("介紹影片", "", False, None))
        response = self.call("patch", f"{URL}{pk}/", {"title": "新標題"})
        self.assertEqual(response.json()["title"], "新標題")
        listing = self.call("get", URL, role=EDITOR).json()
        self.assertEqual([r["id"] for r in listing["results"]], [pk])

    def test_only_publishers_can_write_and_staff_can_read(self):
        pk = self.create()
        for role in (EDITOR, ANALYST, None):
            self.assertIn(self.call("post", URL, {"title": "x"}, role=role).status_code, (401, 403))
            self.assertIn(self.call("patch", f"{URL}{pk}/", {"title": "x"}, role=role).status_code, (401, 403))
            self.assertIn(self.call("delete", f"{URL}{pk}/", role=role).status_code, (401, 403))
            self.assertIn(self.post_file(pk, "cover", jpeg_bytes(), role=role).status_code, (401, 403))
            for kind in ("video", "caption"):
                self.assertIn(self.post_file(pk, kind, b"x", role=role).status_code, (401, 403))
        self.assertEqual(self.call("post", URL, {"title": "y"}, role=ADMIN).status_code, 201)
        self.assertEqual(self.call("get", URL, role=ANALYST).status_code, 200)

    def test_paths_and_probe_results_are_read_only(self):
        pk = self.create()
        self.call("patch", f"{URL}{pk}/", {
            "video_path": "homepage/video/" + "a" * 32 + ".mp4", "cover_path": "x", "caption_path": "y",
            "duration_seconds": 5, "size_bytes": 5, "created_by": "evil",
        })
        video = PromoVideo.objects.get(pk=pk)
        self.assertEqual((video.video_path, video.cover_path, video.caption_path), ("", "", ""))
        self.assertEqual((video.duration_seconds, video.size_bytes), (None, None))
        self.assertNotEqual(video.created_by, "evil")

    def test_validation_errors_are_400(self):
        for payload in ({"title": ""}, {"title": "字" * 61}, {"title": "a\nb"}, {"transcript": "x" * 6001, "title": "t"}):
            with self.subTest(payload=list(payload)):
                self.assertEqual(self.call("post", URL, payload).status_code, 400)

    def test_audit_log_for_create_and_update(self):
        pk = self.create()
        self.call("patch", f"{URL}{pk}/", {"title": "新"})
        actions = list(AuditLog.objects.filter(target_type="promo_video").order_by("pk").values_list("action", flat=True))
        self.assertEqual(actions, ["create", "update"])

    def test_unknown_video_is_404(self):
        self.assertEqual(self.call("get", f"{URL}999/").status_code, 404)
        self.assertEqual(self.post_file(999, "cover", jpeg_bytes()).status_code, 404)


class VideoUploadTest(ApiBase):
    @skip_no_ffmpeg
    def test_valid_upload_stores_file_and_probe_results(self):
        pk = self.create()
        response = self.post_file(pk, "video", fixture_bytes("fast.mp4"), name="../../evil name.mp4")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        video = PromoVideo.objects.get(pk=pk)
        self.assertRegex(video.video_path, r"^homepage/video/[0-9a-f]{32}\.mp4$")  # 檔名由系統產生
        self.assertNotIn("evil", video.video_path)
        self.assertTrue(os.path.isfile(self.abs_path(video.video_path)))
        self.assertEqual(video.duration_seconds, 2)
        self.assertEqual(video.size_bytes, os.path.getsize(self.abs_path(video.video_path)))
        self.assertEqual(data["video_url"], "/media/" + video.video_path)
        self.assertEqual(self.staging_files(), [])
        self.assertEqual(AuditLog.objects.filter(action="upload_video").count(), 1)

    @skip_no_ffmpeg
    def test_video_without_audio_is_accepted(self):
        pk = self.create()
        self.assertEqual(self.post_file(pk, "video", fixture_bytes("silent.mp4")).status_code, 200)

    @skip_no_ffmpeg
    def test_moov_at_end_is_rejected_with_the_fix_command(self):
        pk = self.create()
        response = self.post_file(pk, "video", fixture_bytes("slow.mp4"))
        self.assertEqual(response.status_code, 400)
        self.assertIn("-movflags +faststart", response.json()["detail"])
        self.assert_nothing_changed(pk)

    @skip_no_ffmpeg
    def test_spec_violations_leave_database_and_disk_unchanged(self):
        pk = self.create()
        cases = {"wide.mp4": 422, "yuv444.mp4": 422}
        if "mpeg4.mp4" in _fixtures:
            cases["mpeg4.mp4"] = 422
        for name, status in cases.items():
            with self.subTest(file=name):
                response = self.post_file(pk, "video", fixture_bytes(name))
                self.assertEqual(response.status_code, status, response.content)
                self.assert_nothing_changed(pk)

    def test_non_video_content_is_rejected_whatever_the_name_or_mime(self):
        pk = self.create()
        for data, name, mime in (
            (b"<html><script>alert(1)</script></html>", "a.mp4", "video/mp4"),
            (jpeg_bytes(), "a.mp4", "video/mp4"),
            (b"\x00" * 1000, "a.mp4", "video/mp4"),
            (box(b"ftyp", b"isom") + box(b"moov") + box(b"mdat"), "a.mp4", "video/mp4"),  # 結構對但不是影片
        ):
            with self.subTest(name=name, size=len(data)):
                response = self.post_file(pk, "video", data, name=name, content_type=mime)
                self.assertIn(response.status_code, (400, 422, 503), response.content)
                self.assert_nothing_changed(pk)

    def assert_nothing_changed(self, pk):
        video = PromoVideo.objects.get(pk=pk)
        self.assertEqual((video.video_path, video.duration_seconds, video.size_bytes), ("", None, None))
        self.assertEqual(self.staging_files(), [])
        homepage = os.path.join(self.media_root, "homepage", "video")
        self.assertEqual(os.listdir(homepage) if os.path.isdir(homepage) else [], [])
        self.assertFalse(AuditLog.objects.filter(action__in=["upload_video", "replace_video"]).exists())

    @skip_no_ffmpeg
    def test_replace_creates_new_file_keeps_old_and_marks_it_orphaned(self):
        pk = self.create()
        self.post_file(pk, "video", fixture_bytes("fast.mp4"))
        old = PromoVideo.objects.get(pk=pk).video_path
        old_abs = self.abs_path(old)
        os.utime(old_abs, (time.time() - 90 * 86400,) * 2)  # 舊檔是三個月前上傳的
        response = self.post_file(pk, "video", fixture_bytes("silent.mp4"))
        self.assertEqual(response.status_code, 200)
        new = PromoVideo.objects.get(pk=pk).video_path
        self.assertNotEqual(old, new)  # 不原地替換
        self.assertTrue(os.path.isfile(old_abs))  # 請求內不刪舊檔
        record = PromoMediaOrphan.objects.get(path=old)  # 與替換同一個交易登記孤立時間
        self.assertLess(time.time() - record.orphaned_at.timestamp(), 60)
        self.assertTrue(AuditLog.objects.filter(action="replace_video").exists())
        # 檔案本身再舊也沒關係：依「孤立時間」，剛被取代的 14 天內不會被清
        call_command("cleanup_promo_media", "--apply", stdout=io.StringIO())
        self.assertTrue(os.path.isfile(old_abs))
        self.assertTrue(PromoMediaOrphan.objects.filter(path=old).exists())
        record.orphaned_at = record.orphaned_at - timezone.timedelta(days=15)
        record.save()
        call_command("cleanup_promo_media", "--apply", stdout=io.StringIO())
        self.assertFalse(os.path.exists(old_abs))
        self.assertFalse(PromoMediaOrphan.objects.filter(path=old).exists())
        self.assertTrue(os.path.isfile(self.abs_path(new)))  # 被引用的不會被刪

    def test_oversize_body_is_rejected_before_parsing(self):
        pk = self.create()
        with _as_role(OWNER) as headers:
            response = self.client.post(
                f"{URL}{pk}/video/", {"file": SimpleUploadedFile("a.mp4", b"x")},
                CONTENT_LENGTH=str(upload.max_body_bytes("video") + 1), **headers)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.staging_files(), [])

    def test_streaming_cap_stops_oversize_files(self):
        pk = self.create()
        with patch.dict(upload.KINDS, {"video": ("homepage/video", 1000)}):
            response = self.post_file(pk, "video", b"x" * 5000)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.staging_files(), [])

    def test_missing_or_empty_file_is_400(self):
        pk = self.create()
        with _as_role(OWNER) as headers:
            self.assertEqual(self.client.post(f"{URL}{pk}/video/", {}, **headers).status_code, 400)
        self.assertEqual(self.post_file(pk, "video", b"").status_code, 400)

    @skip_no_ffmpeg
    def test_database_failure_removes_the_committed_file(self):
        pk = self.create()
        with patch("adminapi.promo_video_views._audit", side_effect=RuntimeError("boom")):
            with _as_role(OWNER) as headers:
                self.client.raise_request_exception = False
                response = self.client.post(
                    f"{URL}{pk}/video/", {"file": SimpleUploadedFile("a.mp4", fixture_bytes("fast.mp4"))}, **headers)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(PromoVideo.objects.get(pk=pk).video_path, "")
        homepage = os.path.join(self.media_root, "homepage", "video")
        self.assertEqual(os.listdir(homepage), [])
        self.assertEqual(self.staging_files(), [])

    @skip_no_ffmpeg
    def test_uploaded_video_can_be_activated_and_is_served_as_available(self):
        pk = self.create(description="d", transcript="逐字稿")
        self.post_file(pk, "video", fixture_bytes("fast.mp4"))
        self.post_file(pk, "cover", jpeg_bytes())
        self.post_file(pk, "caption", VTT.encode("utf-8"))
        response = self.call("patch", "/adminapi/homepage-config/", {"active_promo_video": pk})
        self.assertEqual(response.status_code, 200, response.content)
        promo = self.client.get(PUBLIC_CONFIG).json()["promo_video"]
        self.assertTrue(promo["available"])
        self.assertTrue(promo["video_url"].startswith("/media/homepage/video/"))
        self.assertTrue(promo["cover_url"].endswith(".jpg"))
        self.assertTrue(promo["caption_url"].endswith(".vtt"))
        self.assertEqual(promo["transcript"], "逐字稿")
        self.assertEqual(promo["duration_seconds"], 2)


class CommitRollbackTest(ApiBase):
    def test_validation_failure_after_commit_removes_the_new_public_file(self):
        from django.core.exceptions import ValidationError as DjangoValidationError
        pk = self.create()
        with patch.object(PromoVideo, "full_clean", side_effect=DjangoValidationError({"cover_path": ["壞掉"]})):
            response = self.post_file(pk, "cover", jpeg_bytes())
        self.assertEqual(response.status_code, 422)
        self.assertEqual(PromoVideo.objects.get(pk=pk).cover_path, "")
        directory = os.path.join(self.media_root, "homepage", "cover")
        self.assertEqual(os.listdir(directory), [])
        self.assertEqual(self.staging_files(), [])
        self.assertFalse(AuditLog.objects.filter(action__in=["upload_cover", "replace_cover"]).exists())


class CoverCaptionApiTest(ApiBase):
    def test_cover_upload_replace_and_clear(self):
        pk = self.create()
        response = self.post_file(pk, "cover", jpeg_bytes(exif=True), name="p.jpg")
        self.assertEqual(response.status_code, 200, response.content)
        first = PromoVideo.objects.get(pk=pk).cover_path
        self.assertRegex(first, r"^homepage/cover/[0-9a-f]{32}\.jpg$")
        with open(self.abs_path(first), "rb") as f:
            self.assertNotIn(b"SecretCameraMaker", f.read())
        self.post_file(pk, "cover", webp_bytes())
        second = PromoVideo.objects.get(pk=pk).cover_path
        self.assertTrue(second.endswith(".webp"))
        self.assertTrue(os.path.isfile(self.abs_path(first)))  # 舊檔不在請求內刪除
        self.assertTrue(PromoMediaOrphan.objects.filter(path=first).exists())
        response = self.call("delete", f"{URL}{pk}/clear-cover/")
        self.assertEqual(response.json()["cover_path"], "")
        self.assertTrue(PromoMediaOrphan.objects.filter(path=second).exists())
        self.assertEqual(self.call("delete", f"{URL}{pk}/clear-cover/").status_code, 409)
        self.assertEqual(self.staging_files(), [])

    def test_bad_cover_leaves_nothing_behind(self):
        pk = self.create()
        for data in (b"<svg/>", b"GIF89a....", b"junk"):
            self.assertEqual(self.post_file(pk, "cover", data, name="a.jpg", content_type="image/jpeg").status_code, 422)
        self.assertEqual(PromoVideo.objects.get(pk=pk).cover_path, "")
        self.assertEqual(self.staging_files(), [])

    def test_cover_formats_outside_jpeg_and_webp_are_rejected_by_the_decoder_whitelist(self):
        """PNG、TIFF、BMP 即使內容是合法圖片，也不會被解碼（Pillow 的 formats= 白名單），回 422 且不留檔案。"""
        from PIL import Image

        pk = self.create()
        for fmt in ("PNG", "TIFF", "BMP", "GIF"):
            buffer = io.BytesIO()
            Image.new("RGB", (32, 32), (10, 120, 200)).save(buffer, fmt)
            response = self.post_file(pk, "cover", buffer.getvalue(), name="a.jpg", content_type="image/jpeg")
            self.assertEqual(response.status_code, 422, fmt)
        self.assertEqual(PromoVideo.objects.get(pk=pk).cover_path, "")
        self.assertEqual(self.staging_files(), [])

    def test_cover_open_is_locked_to_jpeg_and_webp(self):
        from PIL import Image

        seen = []
        real_open = Image.open

        def spy(fp, mode="r", formats=None):
            seen.append(formats)
            return real_open(fp, mode, formats)

        buffer = io.BytesIO()
        Image.new("RGB", (32, 32), (10, 120, 200)).save(buffer, "JPEG")
        pk = self.create()
        with patch.object(Image, "open", spy):
            self.assertEqual(self.post_file(pk, "cover", buffer.getvalue(), name="a.jpg", content_type="image/jpeg").status_code, 200)
        self.assertTrue(seen and all(formats == ("JPEG", "WEBP") for formats in seen), seen)

    def test_caption_upload_and_errors(self):
        pk = self.create()
        self.assertEqual(self.post_file(pk, "caption", VTT.encode("utf-8")).status_code, 200)
        self.assertRegex(PromoVideo.objects.get(pk=pk).caption_path, r"^homepage/caption/[0-9a-f]{32}\.vtt$")
        response = self.post_file(pk, "caption", "不是字幕".encode("utf-8"))
        self.assertEqual(response.status_code, 422)
        self.assertIn("WebVTT", response.json()["detail"])

    def test_uploads_are_rate_limited(self):
        pk = self.create()
        codes = [self.post_file(pk, "caption", VTT.encode("utf-8")).status_code for _ in range(8)]
        self.assertEqual(codes[:6], [200] * 6)
        self.assertEqual(codes[6:], [429, 429])  # 10 分鐘內第 7 次起被擋


class DeleteTest(ApiBase):
    def test_active_video_cannot_be_deleted(self):
        pk = self.create()
        config = HomepageConfig.load()
        config.active_promo_video = PromoVideo.objects.get(pk=pk)
        config.save()
        response = self.call("delete", f"{URL}{pk}/")
        self.assertEqual(response.status_code, 409)
        self.assertIn("停用", response.json()["detail"])
        self.assertTrue(PromoVideo.objects.filter(pk=pk).exists())

    def test_inactive_video_delete_orphans_files_but_keeps_them(self):
        pk = self.create()
        self.post_file(pk, "cover", jpeg_bytes())
        cover = PromoVideo.objects.get(pk=pk).cover_path
        os.utime(self.abs_path(cover), (time.time() - 30 * 86400,) * 2)
        self.assertEqual(self.call("delete", f"{URL}{pk}/").status_code, 200)
        self.assertFalse(PromoVideo.objects.filter(pk=pk).exists())
        self.assertTrue(os.path.isfile(self.abs_path(cover)))  # 14 天內還在
        self.assertTrue(PromoMediaOrphan.objects.filter(path=cover).exists())
        self.assertTrue(AuditLog.objects.filter(action="delete", target_type="promo_video").exists())


class MaintenanceCommandsTest(ApiBase):
    def test_cleanup_is_preview_by_default_and_never_touches_referenced_or_recent_files(self):
        pk = self.create()
        self.post_file(pk, "cover", jpeg_bytes())
        referenced = self.abs_path(PromoVideo.objects.get(pk=pk).cover_path)
        directory = os.path.dirname(referenced)
        orphan_old = os.path.join(directory, "a" * 32 + ".jpg")
        orphan_new = os.path.join(directory, "b" * 32 + ".jpg")
        for path in (orphan_old, orphan_new):
            with open(path, "wb") as f:
                f.write(b"x")
        os.utime(orphan_old, (time.time() - 20 * 86400,) * 2)  # 從沒被引用過、建立超過 14 天
        os.utime(referenced, (time.time() - 90 * 86400,) * 2)  # 被引用的，再舊也不能刪
        call_command("cleanup_promo_media", stdout=io.StringIO())  # 預覽
        self.assertTrue(os.path.exists(orphan_old))
        call_command("cleanup_promo_media", "--apply", stdout=io.StringIO())
        self.assertFalse(os.path.exists(orphan_old))
        self.assertTrue(os.path.exists(orphan_new))
        self.assertTrue(os.path.exists(referenced))

    def test_orphan_record_beats_file_mtime_in_both_directions(self):
        directory = os.path.join(self.media_root, "homepage", "cover")
        os.makedirs(directory)
        recently_orphaned_old_file = "homepage/cover/" + "1" * 32 + ".jpg"  # 檔案很舊但剛被取代
        long_orphaned_new_file = "homepage/cover/" + "2" * 32 + ".jpg"      # 檔案很新但孤立已久
        for relative in (recently_orphaned_old_file, long_orphaned_new_file):
            with open(self.abs_path(relative), "wb") as f:
                f.write(b"x")
        os.utime(self.abs_path(recently_orphaned_old_file), (time.time() - 200 * 86400,) * 2)
        PromoMediaOrphan.objects.create(path=recently_orphaned_old_file)
        PromoMediaOrphan.objects.create(path=long_orphaned_new_file, orphaned_at=timezone.now() - timezone.timedelta(days=20))
        call_command("cleanup_promo_media", "--apply", stdout=io.StringIO())
        self.assertTrue(os.path.exists(self.abs_path(recently_orphaned_old_file)))
        self.assertFalse(os.path.exists(self.abs_path(long_orphaned_new_file)))

    def test_orphan_records_for_vanished_files_are_housekept_and_referenced_files_kept(self):
        pk = self.create()
        self.post_file(pk, "cover", jpeg_bytes())
        referenced = PromoVideo.objects.get(pk=pk).cover_path
        PromoMediaOrphan.objects.create(path=referenced, orphaned_at=timezone.now() - timezone.timedelta(days=99))
        gone = "homepage/cover/" + "9" * 32 + ".jpg"
        PromoMediaOrphan.objects.create(path=gone)
        call_command("cleanup_promo_media", "--apply", stdout=io.StringIO())
        self.assertTrue(os.path.exists(self.abs_path(referenced)))  # 被引用就不刪，即使紀錄說孤立很久
        self.assertFalse(PromoMediaOrphan.objects.filter(path=gone).exists())

    def test_orphan_marking_rolls_back_together_with_the_replacement(self):
        pk = self.create()
        self.post_file(pk, "cover", jpeg_bytes())
        old = PromoVideo.objects.get(pk=pk).cover_path
        with patch("adminapi.promo_video_views._audit", side_effect=RuntimeError("boom")):
            with _as_role(OWNER) as headers:
                self.client.raise_request_exception = False
                response = self.client.post(f"{URL}{pk}/cover/", {"file": SimpleUploadedFile("a.jpg", jpeg_bytes())}, **headers)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(PromoVideo.objects.get(pk=pk).cover_path, old)  # 還是舊的
        self.assertFalse(PromoMediaOrphan.objects.exists())  # 沒有「已取代」的假紀錄
        self.assertEqual(len(os.listdir(os.path.dirname(self.abs_path(old)))), 1)  # 新檔已撤銷

    def test_cleanup_refuses_a_retention_shorter_than_the_snapshot_window(self):
        with self.assertRaises(CommandError):
            call_command("cleanup_promo_media", "--days", "3", stdout=io.StringIO())

    def test_cleanup_removes_stale_staging_files_only(self):
        os.makedirs(upload.staging_root())
        stale = os.path.join(upload.staging_root(), "old.part")
        fresh = os.path.join(upload.staging_root(), "new.part")
        for path in (stale, fresh):
            with open(path, "wb") as f:
                f.write(b"x")
        os.utime(stale, (time.time() - 3 * 86400,) * 2)
        call_command("cleanup_promo_media", "--apply", stdout=io.StringIO())
        self.assertFalse(os.path.exists(stale))
        self.assertTrue(os.path.exists(fresh))

    def test_cleanup_ignores_symlinks_and_subdirectories(self):
        directory = os.path.join(self.media_root, "homepage", "cover")
        os.makedirs(directory)
        os.makedirs(os.path.join(directory, "subdir"))
        os.utime(os.path.join(directory, "subdir"), (time.time() - 90 * 86400,) * 2)
        call_command("cleanup_promo_media", "--apply", stdout=io.StringIO())
        self.assertTrue(os.path.isdir(os.path.join(directory, "subdir")))

    def test_health_check_passes_with_no_active_video(self):
        out = io.StringIO()
        call_command("check_promo_media", stdout=out)
        self.assertIn("OK", out.getvalue())

    def test_health_check_fails_loudly_when_active_files_are_missing(self):
        pk = self.create()
        video = PromoVideo.objects.get(pk=pk)
        video.video_path = "homepage/video/" + "c" * 32 + ".mp4"
        video.cover_path = "homepage/cover/" + "d" * 32 + ".jpg"
        video.caption_path = "homepage/caption/" + "e" * 32 + ".vtt"
        video.save()
        config = HomepageConfig.load()
        config.active_promo_video = video
        config.save()
        with self.assertLogs("adminapi.management.commands.check_promo_media", level="ERROR") as logs:
            with self.assertRaises(CommandError):
                call_command("check_promo_media", stdout=io.StringIO(), stderr=io.StringIO())
        text = "\n".join(logs.output)
        self.assertIn("PROMO_MEDIA_MISSING", text)
        self.assertIn(video.video_path, text)
        self.assertIn(video.cover_path, text)
        self.assertIn(video.caption_path, text)

    def test_health_check_ignores_missing_files_of_inactive_videos(self):
        pk = self.create()
        video = PromoVideo.objects.get(pk=pk)
        video.video_path = "homepage/video/" + "c" * 32 + ".mp4"
        video.save()
        out = io.StringIO()
        call_command("check_promo_media", stdout=out)
        self.assertIn("提醒", out.getvalue())

    def test_health_check_flags_symlinked_media_directories(self):
        with patch("adminapi.management.commands.check_promo_media.os.path.islink",
                   side_effect=lambda p: p.endswith(os.path.join("homepage", "video"))):
            with self.assertRaises(CommandError):
                call_command("check_promo_media", stdout=io.StringIO(), stderr=io.StringIO())


class PathSafetyTest(MediaTestCase):
    def test_commit_refuses_symlinked_directories(self):
        with patch("adminapi.promo_upload.os.path.islink", side_effect=lambda p: p.endswith("homepage")):
            with self.assertRaises(upload.PromoUploadError) as ctx:
                upload.commit_staged(os.path.join(self.media_root, "none"), "video", "mp4")
        self.assertEqual(ctx.exception.status, 503)

    def test_public_url_requires_an_existing_regular_file(self):
        directory = os.path.join(self.media_root, "homepage", "cover")
        os.makedirs(directory)
        name = "f" * 32 + ".jpg"
        self.assertIsNone(public_media_url(f"homepage/cover/{name}"))
        with open(os.path.join(directory, name), "wb") as f:
            f.write(b"x")
        self.assertEqual(public_media_url(f"homepage/cover/{name}"), f"/media/homepage/cover/{name}")
        self.assertTrue(media_file_exists(f"homepage/cover/{name}"))
