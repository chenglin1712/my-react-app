"""WP-8 追加：propose 與 PUT 同一套草稿所有權規則、提案附帶建立者／送審者姓名、
共用批次姓名查詢 helper（user_names.py）、稽核清單附 actor_name。"""
from datetime import timedelta
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.test import Client, TestCase

from config.roles import ADMIN, EDITOR, OWNER, REVIEWER

from . import user_names
from .dictionary_test_base import DictionaryDbTestCase
from .models import AuditLog, DictionaryRevision
from .test_dictionary_grammar import _MINIMAL_SECTION_PAYLOAD, _current_content_hash as _section_hash
from .test_dictionary_words import _MINIMAL_WORD_PAYLOAD, _current_content_hash, _post_json_raw
from .test_wp8_dictionary import _as_user


def _bump_updated_at(rev, **changes):
    """讓草稿的 updated_at 確實往後移（Windows 時鐘解析度約 15ms，連續兩次 save 可能拿到同一個時間）。"""
    DictionaryRevision.objects.filter(pk=rev.pk).update(updated_at=rev.updated_at + timedelta(seconds=1), **changes)


def _names(mapping):
    return lambda uids: {uid: mapping.get(uid, "") for uid in uids}


class WordProposeOwnershipTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = Client()
        self.seed_tribe()
        self.word_id = self.seed_word(name="original")
        self.url = f"/adminapi/dictionary/words/{self.word_id}/propose/"

    def _existing(self, operation=DictionaryRevision.OPERATION_UPDATE, payload=None, created_by="alice"):
        return DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_WORD, target_id=self.word_id, tribe="tayal",
            operation=operation, payload=payload or {"name": "alice 的"},
            status=DictionaryRevision.STATUS_DRAFT, created_by=created_by,
        )

    def _propose(self, role, uid, name="changed", **extra):
        body = {**_MINIMAL_WORD_PAYLOAD, "name": name, "base_hash": _current_content_hash(self.word_id), **extra}
        with _as_user(role, uid=uid) as headers:
            return _post_json_raw(self.client, self.url, headers, body)

    def test_publishers_can_write_into_someone_elses_draft(self):
        # WP-8 追加：覆寫別人的草稿必須帶載入時的 base_updated_at（樂觀鎖），見下方 409 的測試
        for role, uid in ((ADMIN, "admin-1"), (OWNER, "owner-1")):
            with self.subTest(role=role):
                DictionaryRevision.objects.all().delete()
                rev = self._existing()
                resp = self._propose(role, uid, name=f"by-{role}", base_updated_at=rev.updated_at.isoformat())
                self.assertEqual(resp.status_code, 200)
                rev.refresh_from_db()
                self.assertEqual(rev.payload["name"], f"by-{role}")
                # 草稿仍屬於原建立者（與 PUT 一致，不轉移所有權）
                self.assertEqual(rev.created_by, "alice")
                self.assertEqual(DictionaryRevision.objects.count(), 1)

    def test_overwriting_someone_elses_draft_without_base_updated_at_is_409(self):
        # WP-8 追加：停在舊頁面（載入時還沒有這份草稿）的管理員按儲存，不能無聲蓋掉 alice 的草稿
        rev = self._existing()
        resp = self._propose(ADMIN, "admin-1")
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["code"], "edit_conflict")
        self.assertIn("base_updated_at", resp.json()["errors"])
        # 前端「載入最新內容」靠 revision_id 找到這份它原本不知道的草稿
        self.assertEqual(resp.json()["revision_id"], rev.pk)
        rev.refresh_from_db()
        self.assertEqual(rev.payload, {"name": "alice 的"})

    def test_overwriting_someone_elses_draft_with_stale_base_updated_at_is_409(self):
        rev = self._existing()
        loaded_at = rev.updated_at.isoformat()
        _bump_updated_at(rev, payload={"name": "alice 又改了"})
        resp = self._propose(OWNER, "owner-1", base_updated_at=loaded_at)
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["code"], "edit_conflict")
        self.assertEqual(resp.json()["revision_id"], rev.pk)
        rev.refresh_from_db()
        self.assertEqual(rev.payload, {"name": "alice 又改了"})

    def test_malformed_base_updated_at_is_400(self):
        self._existing()
        self.assertEqual(self._propose(ADMIN, "admin-1", base_updated_at="not-a-date").status_code, 400)

    def test_creator_overwriting_own_draft_does_not_need_base_updated_at(self):
        rev = self._existing(created_by="alice")
        self.assertEqual(self._propose(EDITOR, "alice", name="自己改").status_code, 200)
        rev.refresh_from_db()
        self.assertEqual(rev.payload["name"], "自己改")
        # base_updated_at 不會被存進提案內容
        self.assertNotIn("base_updated_at", rev.payload)

    def test_creator_with_stale_base_updated_at_is_still_rejected(self):
        # 有帶就比對：同一人在兩個分頁各存一次時，後存的不會蓋掉先存的
        rev = self._existing(created_by="alice")
        loaded_at = rev.updated_at.isoformat()
        _bump_updated_at(rev)
        self.assertEqual(self._propose(EDITOR, "alice", base_updated_at=loaded_at).status_code, 409)

    def test_other_editor_gets_the_same_403_as_put(self):
        rev = self._existing()
        resp = self._propose(EDITOR, "bob")
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["code"], "not_draft_owner")
        rev.refresh_from_db()
        self.assertEqual(rev.payload, {"name": "alice 的"})

    def test_creator_can_still_write(self):
        self._existing(created_by="alice")
        self.assertEqual(self._propose(EDITOR, "alice").status_code, 200)

    def test_delete_draft_is_never_turned_into_a_content_proposal_even_by_admin(self):
        self._existing(operation=DictionaryRevision.OPERATION_DELETE, payload={"unlink_references": False})
        for role, uid in ((ADMIN, "admin-1"), (EDITOR, "alice")):
            with self.subTest(role=role):
                self.assertEqual(self._propose(role, uid).status_code, 409)
        self.assertEqual(DictionaryRevision.objects.get().operation, DictionaryRevision.OPERATION_DELETE)


class GrammarProposeOwnershipTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = Client()
        self.seed_tribe()
        with _as_user(EDITOR) as headers:
            created = _post_json_raw(self.client, "/adminapi/dictionary/grammar/sections/", headers,
                                     _MINIMAL_SECTION_PAYLOAD)
        revision_id = created.json()["revision_id"]
        with _as_user(EDITOR) as headers:
            _post_json_raw(self.client, f"/adminapi/dictionary/revisions/{revision_id}/submit/", headers)
        with _as_user(REVIEWER) as headers:
            approved = _post_json_raw(self.client, f"/adminapi/dictionary/revisions/{revision_id}/approve/", headers)
        self.section_id = approved.json()["target_id"]
        self.url = f"/adminapi/dictionary/grammar/sections/{self.section_id}/propose/"

    def _existing(self, operation=DictionaryRevision.OPERATION_UPDATE):
        return DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_GRAMMAR_SECTION, target_id=str(self.section_id), tribe="tayal",
            operation=operation, payload={"title": "alice 的"},
            status=DictionaryRevision.STATUS_DRAFT, created_by="alice",
        )

    def _propose(self, role, uid, **extra):
        body = {**_MINIMAL_SECTION_PAYLOAD, "title": "改過", "base_hash": _section_hash(self.section_id), **extra}
        with _as_user(role, uid=uid) as headers:
            return _post_json_raw(self.client, self.url, headers, body)

    def test_admin_can_write_into_someone_elses_draft(self):
        # WP-8 追加：覆寫別人的草稿必須帶載入時的 base_updated_at
        rev = self._existing()
        self.assertEqual(
            self._propose(ADMIN, "admin-1", base_updated_at=rev.updated_at.isoformat()).status_code, 200,
        )
        rev.refresh_from_db()
        self.assertEqual(rev.payload["title"], "改過")
        self.assertEqual(rev.created_by, "alice")

    def test_admin_overwriting_someone_elses_draft_without_or_with_stale_base_is_409(self):
        rev = self._existing()
        loaded_at = rev.updated_at.isoformat()
        missing = self._propose(ADMIN, "admin-1")
        self.assertEqual(missing.status_code, 409)
        self.assertEqual(missing.json()["code"], "edit_conflict")
        _bump_updated_at(rev)
        stale = self._propose(OWNER, "owner-1", base_updated_at=loaded_at)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["code"], "edit_conflict")
        rev.refresh_from_db()
        self.assertEqual(rev.payload, {"title": "alice 的"})

    def test_creator_overwriting_own_draft_does_not_need_base_updated_at(self):
        rev = self._existing()
        self.assertEqual(self._propose(EDITOR, "alice").status_code, 200)
        rev.refresh_from_db()
        self.assertEqual(rev.payload["title"], "改過")
        self.assertNotIn("base_updated_at", rev.payload)

    def test_other_editor_is_403(self):
        self._existing()
        resp = self._propose(EDITOR, "bob")
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["code"], "not_draft_owner")

    def test_delete_draft_stays_409_for_admin(self):
        self._existing(operation=DictionaryRevision.OPERATION_DELETE)
        self.assertEqual(self._propose(ADMIN, "admin-1").status_code, 409)

    def test_section_detail_open_revision_carries_names(self):
        self._existing()
        self.fetch_names.side_effect = _names({"alice": "Alice 王"})
        with _as_user(EDITOR, uid="bob") as headers:
            meta = self.client.get(f"/adminapi/dictionary/grammar/sections/{self.section_id}/", **headers).json()["meta"]
        self.assertEqual(meta["open_revision"]["created_by_name"], "Alice 王")
        self.assertEqual(meta["open_revision"]["submitted_by_name"], "")


class RevisionActorNamesTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = Client()
        self.seed_tribe()
        self.word_id = self.seed_word(name="target")
        self.rev = DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_WORD, target_id=self.word_id, tribe="tayal",
            operation=DictionaryRevision.OPERATION_UPDATE, payload=dict(_MINIMAL_WORD_PAYLOAD, name="target"),
            status=DictionaryRevision.STATUS_PENDING_REVIEW, created_by="alice", submitted_by="carol",
        )

    def test_word_detail_open_revision_has_creator_and_submitter_names_in_one_batch(self):
        self.fetch_names.side_effect = _names({"alice": "Alice", "carol": "Carol"})
        with _as_user(EDITOR, uid="bob") as headers:
            meta = self.client.get(f"/adminapi/dictionary/words/{self.word_id}/", **headers).json()["meta"]
        self.assertEqual(meta["open_revision"]["created_by_name"], "Alice")
        self.assertEqual(meta["open_revision"]["submitted_by_name"], "Carol")
        self.assertEqual(self.fetch_names.call_count, 1)
        self.assertEqual(set(self.fetch_names.call_args[0][0]), {"alice", "carol"})

    def test_revision_get_has_names(self):
        self.fetch_names.side_effect = _names({"alice": "Alice"})
        with _as_user(REVIEWER) as headers:
            body = self.client.get(f"/adminapi/dictionary/revisions/{self.rev.pk}/", **headers).json()
        self.assertEqual(body["created_by_name"], "Alice")
        self.assertEqual(body["submitted_by_name"], "")

    def test_name_lookup_failure_does_not_break_the_request(self):
        self.fetch_names.side_effect = Exception("firebase down")
        with _as_user(REVIEWER) as headers:
            resp = self.client.get(f"/adminapi/dictionary/revisions/{self.rev.pk}/", **headers)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["created_by_name"], "")
        self.assertEqual(resp.json()["created_by"], "alice")


class UserNamesHelperTest(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def test_batches_dedupes_skips_placeholders_and_caches(self):
        with patch("adminapi.user_names._fetch_names", side_effect=_names({"u1": "甲"})) as fetch:
            first = user_names.lookup_user_names(["u1", "u2", "u1", "", "anon", "system", "a/b"])
            second = user_names.lookup_user_names(["u1", "u2"])
        self.assertEqual(first, {"u1": "甲", "u2": "", "": "", "anon": "", "system": "", "a/b": ""})
        self.assertEqual(second, {"u1": "甲", "u2": ""})
        fetch.assert_called_once()
        self.assertEqual(sorted(fetch.call_args[0][0]), ["u1", "u2"])

    def test_failure_returns_blanks_and_backs_off(self):
        with patch("adminapi.user_names._fetch_names", side_effect=Exception("timeout")) as fetch:
            self.assertEqual(user_names.lookup_user_names(["u1"]), {"u1": ""})
            self.assertEqual(user_names.lookup_user_names(["u1"]), {"u1": ""})
        # 失敗後退避期間不再打 Firebase，避免每個請求都白等逾時
        fetch.assert_called_once()

    def test_forget_user_name_drops_the_cached_value(self):
        with patch("adminapi.user_names._fetch_names", side_effect=_names({"u1": "舊名"})):
            user_names.lookup_user_names(["u1"])
        user_names.forget_user_name("u1")
        with patch("adminapi.user_names._fetch_names", side_effect=_names({"u1": "新名"})):
            self.assertEqual(user_names.lookup_user_name("u1"), "新名")

    def test_invalid_firestore_document_ids_are_never_sent(self):
        # WP-8 追加：保留 id（.、..、__x__）、過長、含空白或控制字元的 uid 送進 get_all 會讓整批丟例外
        bad = [".", "..", "__backoff__", "____", "__x__", "a" * 129, "has space", "tab\tuid", "nl\nuid", "a/b"]
        ok = ["u1", "a" * 128, "__x", "x__", "___", "user.name"]
        with patch("adminapi.user_names._fetch_names", side_effect=_names({})) as fetch:
            result = user_names.lookup_user_names(bad + ok)
        self.assertEqual(set(result), set(bad + ok))
        self.assertTrue(all(value == "" for value in result.values()))
        fetch.assert_called_once()
        self.assertEqual(sorted(fetch.call_args[0][0]), sorted(ok))

    def test_backoff_flag_does_not_share_a_key_with_any_uid_cache_entry(self):
        # WP-8 追加：退避鍵原本是 user_name:__backoff__，與 uid「__backoff__」的姓名快取鍵相同
        self.assertFalse(user_names._BACKOFF_KEY.startswith(user_names._CACHE_PREFIX))
        with patch("adminapi.user_names._fetch_names", side_effect=Exception("timeout")):
            user_names.lookup_user_names(["u1"])
        self.assertTrue(cache.get(user_names._BACKOFF_KEY))
        # 姓名快取寫入不會蓋掉退避旗標；忘記某個 uid 的姓名也不會清掉退避
        cache.set(user_names._CACHE_PREFIX + "u2", "乙", 60)
        user_names.forget_user_name("__backoff__")
        self.assertTrue(cache.get(user_names._BACKOFF_KEY))
        with patch("adminapi.user_names._fetch_names", side_effect=_names({"u3": "丙"})) as fetch:
            self.assertEqual(user_names.lookup_user_names(["u2", "u3"]), {"u2": "乙", "u3": ""})
        fetch.assert_not_called()

    def test_fetch_reads_only_the_name_field_with_a_timeout(self):
        snap = MagicMock(id="u1", exists=True)
        snap.to_dict.return_value = {"name": " 甲 "}
        client = MagicMock()
        client.get_all.return_value = [snap]
        with patch("adminapi.firebase_ops.get_firestore_client", return_value=client):
            self.assertEqual(user_names._fetch_names(["u1", "u2"]), {"u1": "甲", "u2": ""})
        kwargs = client.get_all.call_args.kwargs
        self.assertEqual(kwargs["field_paths"], ["name"])
        self.assertEqual(kwargs["timeout"], user_names.LOOKUP_TIMEOUT_SECONDS)


class AuditLogActorNameTest(TestCase):
    def setUp(self):
        cache.clear()
        AuditLog.objects.create(actor_uid="alice", actor_role="owner", action="update", target_type="x", target_id="1")
        AuditLog.objects.create(actor_uid="bob", actor_role="owner", action="update", target_type="x", target_id="2")
        AuditLog.objects.create(actor_uid="alice", actor_role="owner", action="delete", target_type="x", target_id="3")

    def test_actor_name_is_attached_with_one_batched_lookup(self):
        with patch("adminapi.user_names._fetch_names", side_effect=_names({"alice": "Alice"})) as fetch, \
             _as_user(OWNER) as headers:
            body = Client().get("/adminapi/audit-log/?page_size=10", **headers).json()
        fetch.assert_called_once()
        self.assertEqual(sorted(fetch.call_args[0][0]), ["alice", "bob"])
        by_target = {row["target_id"]: row for row in body["results"]}
        self.assertEqual(by_target["1"]["actor_name"], "Alice")
        self.assertEqual(by_target["2"]["actor_name"], "")
        self.assertEqual(by_target["2"]["actor_uid"], "bob")

    def test_lookup_failure_still_returns_the_list(self):
        with patch("adminapi.user_names._fetch_names", side_effect=Exception("down")), \
             _as_user(OWNER) as headers:
            resp = Client().get("/adminapi/audit-log/", **headers)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(all(row["actor_name"] == "" for row in resp.json()["results"]))
