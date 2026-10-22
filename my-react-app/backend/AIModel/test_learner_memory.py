"""路線圖 #21：學習者記憶 —— 聊天接上記憶工具與「我的學習記憶」端點。（儲存層見 test_memory_store.py）"""
import json
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.http import JsonResponse
from django.test import Client, TestCase

from adminapi.models import FeatureFlag, LearnerMemoryConsent, LearnerMemoryFile
from AIModel import memory_store as ms
from AIModel.services import MEMORY_TOOL, _tool_result_blocks, run_tayal_chat, stream_tayal_chat, system_text
from AIModel.tests import _mock_response


def _tool_use(name, tool_input, tool_id="tu0"):
    block = MagicMock(type="tool_use", id=tool_id, input=tool_input)
    block.name = name
    return MagicMock(stop_reason="tool_use", content=[block])


def _enable(enabled=True):
    FeatureFlag.objects.update_or_create(key=ms.FEATURE_FLAG, defaults={"label": "x", "enabled": enabled})


class ChatWithMemoryTest(TestCase):
    def _chat(self, responses, memory=True, uid="u1"):
        client = MagicMock()
        client.messages.create.side_effect = responses
        with patch("AIModel.services.choose_flow", return_value="chat"):
            result = run_tayal_chat(client, "泰雅語", "我常搞混 su", None, uid=uid, memory=memory)
        return result, client

    def test_memory_tool_is_offered_with_rules_only_when_memory_is_on(self):
        _, on = self._chat([_mock_response("好的")], memory=True)
        kwargs = on.messages.create.call_args.kwargs
        self.assertIn(MEMORY_TOOL, kwargs["tools"])
        self.assertIn("學習記憶目錄", system_text(kwargs["system"]))

        _, off = self._chat([_mock_response("好的")], memory=False)
        kwargs = off.messages.create.call_args.kwargs
        self.assertNotIn("tools", kwargs)
        self.assertNotIn("學習記憶目錄", system_text(kwargs["system"]))

    def test_model_can_write_a_note_and_the_result_goes_back_to_it(self):
        ms.grant_consent("u1")
        result, client = self._chat([
            _tool_use("memory", {"command": "create", "path": "/memories/mistakes.txt", "file_text": "常把 su 當動詞"}),
            _mock_response("我記下來了"),
        ])
        self.assertEqual(result["message"], "我記下來了")
        self.assertEqual(LearnerMemoryFile.objects.get(uid="u1").content, "常把 su 當動詞")
        sent = client.messages.create.call_args_list[1].kwargs["messages"][-1]["content"][0]
        self.assertEqual(sent["tool_use_id"], "tu0")
        self.assertIn("File created successfully", sent["content"])

    def test_bad_memory_request_is_returned_as_error_not_applied(self):
        ms.grant_consent("u1")
        _, client = self._chat([
            _tool_use("memory", {"command": "create", "path": "/memories/../x", "file_text": "x"}),
            _mock_response("好"),
        ])
        sent = client.messages.create.call_args_list[1].kwargs["messages"][-1]["content"][0]
        self.assertTrue(sent["is_error"])
        self.assertEqual(LearnerMemoryFile.objects.count(), 0)

    def test_pii_in_a_note_is_refused(self):
        ms.grant_consent("u1")
        _, client = self._chat([
            _tool_use("memory", {"command": "create", "path": "/memories/me.txt", "file_text": "信箱 a@b.co"}),
            _mock_response("好"),
        ])
        self.assertTrue(client.messages.create.call_args_list[1].kwargs["messages"][-1]["content"][0]["is_error"])
        self.assertEqual(LearnerMemoryFile.objects.count(), 0)

    def test_memory_tool_call_is_refused_without_consent_even_if_the_model_asks(self):
        # 呼叫端漏判（memory=True）時，儲存層沒有同意一樣不會讀寫
        _, client = self._chat([
            _tool_use("memory", {"command": "create", "path": "/memories/a.txt", "file_text": "x"}),
            _mock_response("好"),
        ])
        self.assertTrue(client.messages.create.call_args_list[1].kwargs["messages"][-1]["content"][0]["is_error"])
        self.assertEqual(LearnerMemoryFile.objects.count(), 0)

    def test_memory_request_when_memory_is_off_is_rejected_without_touching_the_database(self):
        ms.grant_consent("u1")
        use = MagicMock(id="tu0", input={"command": "create", "path": "/memories/a.txt", "file_text": "x"})
        use.name = "memory"
        with patch("AIModel.services.memory_store.execute") as execute:
            blocks = _tool_result_blocks(None, [use], "u1", memory=False)
        self.assertTrue(blocks[0]["is_error"])
        execute.assert_not_called()
        self.assertEqual(LearnerMemoryFile.objects.count(), 0)

    def test_unexpected_storage_failure_does_not_break_the_conversation(self):
        ms.grant_consent("u1")
        with patch("AIModel.services.memory_store.execute", side_effect=RuntimeError("db down")), \
                self.assertLogs("AIModel.services", level="ERROR"):
            result, client = self._chat([
                _tool_use("memory", {"command": "view", "path": "/memories"}),
                _mock_response("直接回答"),
            ])
        self.assertEqual(result["message"], "直接回答")
        content = client.messages.create.call_args_list[1].kwargs["messages"][-1]["content"][0]["content"]
        self.assertNotIn("db down", content)

    def test_stream_also_uses_the_memory_tool(self):
        ms.grant_consent("u1")
        seen = []

        def fake(*args, **kwargs):
            seen.append(kwargs)
            return iter([])

        with patch("AIModel.services.choose_flow", return_value="chat"),                 patch("AIModel.services.stream_claude", side_effect=fake):
            try:
                list(stream_tayal_chat(MagicMock(), "泰雅語", "嗨", None, uid="u1", memory=True))
            except Exception:
                pass            # 假的串流沒有 done 事件，丟什麼例外都無妨；要驗證的是送出的參數
        self.assertTrue(seen)
        self.assertIn(MEMORY_TOOL, seen[0]["tools"])


class MemoryEndpointTest(TestCase):
    def setUp(self):
        self.http = Client()
        cache.clear()
        self.uid = "u1"
        patcher = patch("AIModel.memory_views.verify_firebase_token", side_effect=lambda r: ({"uid": self.uid}, None))
        patcher.start()
        self.addCleanup(patcher.stop)

    def _json(self, method, url, payload=None):
        return getattr(self.http, method)(url, data=json.dumps(payload or {}), content_type="application/json")

    def test_default_state_is_off_and_empty(self):
        body = self.http.get("/AIModel/memory/").json()
        self.assertEqual((body["enabled"], body["consented"], body["files"]), (False, False, []))
        self.assertEqual(body["retentionDays"], 180)

    def test_consent_needs_the_feature_flag_but_revoking_never_does(self):
        denied = self._json("post", "/AIModel/memory/consent/", {"granted": True})
        self.assertEqual((denied.status_code, denied.json()["code"]), (403, "learner_memory_disabled"))
        self.assertFalse(ms.has_consent("u1"))

        _enable()
        self.assertTrue(self._json("post", "/AIModel/memory/consent/", {"granted": True}).json()["consented"])
        _enable(False)
        self.assertFalse(self._json("post", "/AIModel/memory/consent/", {"granted": False}).json()["consented"])

    def test_revoking_deletes_all_notes(self):
        _enable()
        self._json("post", "/AIModel/memory/consent/", {"granted": True})
        ms.execute("u1", {"command": "create", "path": "/memories/a.txt", "file_text": "筆記"})

        body = self._json("post", "/AIModel/memory/consent/", {"granted": False}).json()

        self.assertEqual((body["consented"], body["files"]), (False, []))
        self.assertEqual(LearnerMemoryFile.objects.count(), 0)
        self.assertEqual(LearnerMemoryConsent.objects.count(), 0)

    def test_view_edit_delete_and_clear_own_notes(self):
        _enable()
        ms.grant_consent("u1")
        ms.execute("u1", {"command": "create", "path": "/memories/a.txt", "file_text": "舊"})
        ms.execute("u1", {"command": "create", "path": "/memories/b.txt", "file_text": "乙"})

        self.assertEqual([f["path"] for f in self.http.get("/AIModel/memory/").json()["files"]], ["a.txt", "b.txt"])
        edited = self._json("put", "/AIModel/memory/file/", {"path": "a.txt", "content": "新"}).json()
        self.assertEqual(edited["files"][0]["content"], "新")
        self.assertEqual(len(self.http.delete("/AIModel/memory/file/?path=b.txt").json()["files"]), 1)
        self.assertEqual(self.http.delete("/AIModel/memory/file/?path=b.txt").status_code, 404)
        self.assertEqual(self.http.delete("/AIModel/memory/").json()["files"], [])
        self.assertTrue(ms.has_consent("u1"))        # 全部清除不等於撤回同意

    def test_user_edits_are_validated_like_the_model_writes(self):
        _enable()
        ms.grant_consent("u1")
        ms.execute("u1", {"command": "create", "path": "/memories/a.txt", "file_text": "x"})
        for payload in ({"path": "../a.txt", "content": "x"}, {"path": "a.txt", "content": "https://evil.example"},
                        {"path": "none.txt", "content": "x"}):
            with self.subTest(payload=payload):
                self.assertEqual(self._json("put", "/AIModel/memory/file/", payload).status_code, 400)
        self.assertEqual(LearnerMemoryFile.objects.get().content, "x")

    def test_one_user_cannot_see_or_change_anothers_notes(self):
        _enable()
        ms.grant_consent("u1")
        ms.grant_consent("u2")
        ms.execute("u1", {"command": "create", "path": "/memories/a.txt", "file_text": "u1 的"})
        self.uid = "u2"

        self.assertEqual(self.http.get("/AIModel/memory/").json()["files"], [])
        self.assertEqual(self.http.delete("/AIModel/memory/file/?path=a.txt").status_code, 404)
        self.assertEqual(self._json("put", "/AIModel/memory/file/", {"path": "a.txt", "content": "x"}).status_code, 400)
        self.http.delete("/AIModel/memory/")
        self.assertEqual(LearnerMemoryFile.objects.get().uid, "u1")

    def test_unauthenticated_and_wrong_methods_are_rejected(self):
        with patch("AIModel.memory_views.verify_firebase_token", return_value=(None, JsonResponse({"detail": "x"}, status=401))) as v:
            self.assertEqual(self.http.get("/AIModel/memory/").status_code, 401)
            v.assert_called()
        self.assertEqual(self.http.post("/AIModel/memory/").status_code, 405)
        self.assertEqual(self.http.get("/AIModel/memory/consent/").status_code, 405)

    def test_invalid_bodies_are_400(self):
        self.assertEqual(self._json("post", "/AIModel/memory/consent/", {"granted": "maybe"}).status_code, 400)
        self.assertEqual(self.http.post("/AIModel/memory/consent/", data="not json", content_type="application/json").status_code, 400)
        self.assertEqual(self._json("put", "/AIModel/memory/file/", {"path": "a.txt"}).status_code, 400)


class ChatGateTest(TestCase):
    def test_active_for_needs_flag_and_consent(self):
        self.assertFalse(ms.active_for("u1"))
        ms.grant_consent("u1")
        self.assertFalse(ms.active_for("u1"))        # 旗標關閉
        _enable()
        self.assertTrue(ms.active_for("u1"))
        self.assertFalse(ms.active_for("u2"))        # 沒同意
        _enable(False)
        self.assertFalse(ms.active_for("u1"))


class AccountLifecycleTest(TestCase):
    """帳號刪除、匯出與保存期限（記憶存在 Django 資料庫，不在 Firestore，所以要明確處理）。"""

    def _seed(self):
        for uid in ("uid1", "other"):
            ms.grant_consent(uid)
            ms.execute(uid, {"command": "create", "path": "/memories/a.txt", "file_text": f"{uid} 的筆記"})

    def test_purge_command_previews_then_deletes_only_expired_files(self):
        import datetime
        from io import StringIO
        from django.core.management import call_command
        from django.utils import timezone

        self._seed()
        LearnerMemoryFile.objects.filter(uid="other").update(
            updated_at=timezone.now() - datetime.timedelta(days=ms.RETENTION_DAYS + 1))
        out = StringIO()
        call_command("purge_learner_memory", stdout=out)
        self.assertIn("預覽", out.getvalue())
        self.assertEqual(LearnerMemoryFile.objects.count(), 2)

        call_command("purge_learner_memory", "--yes", stdout=StringIO())
        self.assertEqual(list(LearnerMemoryFile.objects.values_list("uid", flat=True)), ["uid1"])

    def test_purge_command_by_uid_revokes_consent(self):
        from io import StringIO
        from django.core.management import call_command

        self._seed()
        call_command("purge_learner_memory", "--uid", "uid1", "--yes", stdout=StringIO())
        self.assertFalse(ms.has_consent("uid1"))
        self.assertTrue(ms.has_consent("other"))
