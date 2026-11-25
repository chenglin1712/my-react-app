"""稽核 WP-7：辭典匯入匯出與審核的修正（BE2b-01/02/03/05/06/07/08/10/12/13/14/16）。"""
import io
import json
from contextlib import redirect_stdout
from datetime import timedelta
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.core.management import call_command
from django.test import Client, TestCase
from django.utils import timezone

from config.roles import EDITOR, OWNER, REVIEWER
from config.tribes import TRIBES
from dictionary_db import connect as connect_module
from dictionary_db import model as m

from .dictionary_test_base import DictionaryDbTestCase
from .models import DictionaryImportJob, DictionaryRevision, UsageEvent
from .test_dictionary_import import _as_role, _minimal_bundle, _post_json
from .test_dictionary_words import _MINIMAL_WORD_PAYLOAD, _current_content_hash, _post_json_raw, _put_json

_TAYAL = TRIBES[0]


class _ImportBase(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = Client()
        self.tribe_id = self.seed_tribe(tribe_id=_TAYAL.id, name=_TAYAL.full_name, slug=_TAYAL.slug)

    def _upload(self, words):
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, "/adminapi/dictionary/import/", headers,
                                  {"filename": "t.json", "bundle": _minimal_bundle(words)})
        return response.json()

    def _preflight(self, job_id):
        with _as_role(EDITOR) as headers:
            return _post_json(self.client, f"/adminapi/dictionary/import/{job_id}/preflight/", headers)


class ImportStructureAndLinksTest(_ImportBase):
    def test_preflight_marks_structurally_invalid_rows_as_errors(self):
        job = self._upload([
            {"name": "好詞", "explanations": [{"chinese_explanation": "x"}]},
            {"name": "壞詞", "explanations": "不是陣列"},
            "整列不是物件",
        ])
        report = self._preflight(job["id"]).json()["report"]
        actions = [item["action"] for item in report["items"]]
        self.assertEqual(actions, ["create", "error", "error"])
        self.assertTrue(report["items"][1]["errors"])
        self.assertIsNone(report["items"][1]["payload"])

    def test_malformed_taxonomy_name_lists_are_row_errors_not_500(self):
        job = self._upload([
            {"name": "a", "source_names": [["x"]]},
            {"name": "b", "explanations": [{"chinese_explanation": "x", "category_names": [{"k": 1}]}]},
            {"name": "c", "explanations": [{"chinese_explanation": "x", "pos_names": [5, "n"]}]},
            {"name": "d", "explanations": [{"chinese_explanation": "x", "focus_names": ["", "  "]}]},
        ])
        response = self._preflight(job["id"])
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["action"] for item in response.json()["report"]["items"]], ["error"] * 4)
        with _as_role(OWNER) as headers:
            created = _post_json(self.client, f"/adminapi/dictionary/import/{job['id']}/auto-create-taxonomies/", headers)
        self.assertEqual(created.status_code, 200)
        self.assertEqual(created.json()["created_taxonomies"], {"source": [], "category": [], "part_of_speech": [], "focus": []})

    def test_non_string_filename_is_400(self):
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, "/adminapi/dictionary/import/", headers,
                                  {"filename": {"x": 1}, "bundle": _minimal_bundle([{"name": "a"}])})
        self.assertEqual(response.status_code, 400)

    def test_job_detail_reports_word_count(self):
        job = self._upload([{"name": "a"}, {"name": "b"}, {"name": "c"}])
        with _as_role(EDITOR) as headers:
            detail = self.client.get(f"/adminapi/dictionary/import/{job['id']}/", **headers).json()
        self.assertEqual(detail["word_count"], 3)

    def _anaphora_word(self, item):
        return {
            "name": "新詞",
            "explanations": [{"chinese_explanation": "x", "sentences": [{
                "original_sentence": "x", "anaphoras": [{"items": [item]}],
            }]}],
        }

    def test_explicit_word_id_wins_over_ambiguous_names(self):
        self.seed_word("same-1", self.tribe_id, "同名")
        self.seed_word("same-2", self.tribe_id, "同名")
        job = self._upload([self._anaphora_word({"word_name": "同名", "word_id": "same-2"})])
        item = self._preflight(job["id"]).json()["report"]["items"][0]
        link = item["payload"]["explanations"][0]["sentences"][0]["anaphoras"][0]["items"][0]
        self.assertEqual(link["word_id"], "same-2")
        self.assertEqual(item["warnings"], [])

    def test_unresolvable_links_become_warnings_not_silent(self):
        self.seed_word("same-1", self.tribe_id, "同名")
        self.seed_word("same-2", self.tribe_id, "同名")
        job = self._upload([
            self._anaphora_word({"word_name": "同名"}),
            self._anaphora_word({"word_name": "x", "word_id": "不存在的id"}),
        ])
        report = self._preflight(job["id"]).json()["report"]
        self.assertTrue(report["items"][0]["warnings"])
        self.assertTrue(report["items"][1]["warnings"])
        self.assertEqual(report["warning_count"], sum(len(i["warnings"]) for i in report["items"]))

    def test_word_id_from_another_tribe_is_not_trusted(self):
        other = self.seed_tribe(tribe_id="tribe-amis", name="阿美語", slug="amis")
        self.seed_word("amis-word", other, "別族語")
        job = self._upload([self._anaphora_word({"word_name": "", "word_id": "amis-word"})])
        item = self._preflight(job["id"]).json()["report"]["items"][0]
        link = item["payload"]["explanations"][0]["sentences"][0]["anaphoras"][0]["items"][0]
        self.assertIsNone(link["word_id"])
        self.assertTrue(item["warnings"])

    def test_export_includes_word_id_and_roundtrip_keeps_the_link(self):
        self.seed_word("dup-1", self.tribe_id, "同名")
        self.seed_word("dup-2", self.tribe_id, "同名")
        db = connect_module.SessionLocal()
        try:
            host = m.Word(id="host", tribe_id=self.tribe_id, name="宿主")
            db.add(host)
            db.flush()
            explanation = m.WordExplanation(word_id="host", chinese_explanation="x")
            db.add(explanation)
            db.flush()
            sentence = m.WordExplanationSentence(explanation_id=explanation.id, original_sentence="s")
            db.add(sentence)
            db.flush()
            anaphora = m.WordExplanationAnaphora(sentence_id=sentence.id)
            db.add(anaphora)
            db.flush()
            db.add(m.WordExplanationAnaphoraItem(anaphora_id=anaphora.id, word_id="dup-2", name="同名"))
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
        with _as_role(EDITOR) as headers:
            bundle = json.loads(self.client.get("/adminapi/dictionary/export/?tribe=tayal", **headers).content)
        host_entry = next(word for word in bundle["words"] if word["id"] == "host")
        exported_item = host_entry["explanations"][0]["sentences"][0]["anaphoras"][0]["items"][0]
        self.assertEqual(exported_item["word_id"], "dup-2")

        with _as_role(EDITOR) as headers:
            job = _post_json(self.client, "/adminapi/dictionary/import/", headers,
                             {"filename": "r.json", "bundle": bundle}).json()
            report = _post_json(self.client, f"/adminapi/dictionary/import/{job['id']}/preflight/", headers).json()["report"]
        host_item = next(item for item in report["items"] if item["word_id"] == "host")
        link = host_item["payload"]["explanations"][0]["sentences"][0]["anaphoras"][0]["items"][0]
        self.assertEqual(link["word_id"], "dup-2")


class AutoCreateRaceTest(_ImportBase):
    def test_a_job_submitted_meanwhile_is_not_reset_to_validated(self):
        job = self._upload([{"name": "a", "explanations": [{"chinese_explanation": "x", "category_names": ["新分類"]}]}])
        job_id = job["id"]

        original = __import__("adminapi.dictionary_import_views", fromlist=["x"]).create_missing_taxonomies

        def create_then_submit(write_db, words):
            result = original(write_db, words)
            DictionaryImportJob.objects.filter(pk=job_id).update(status=DictionaryImportJob.STATUS_PENDING_REVIEW)
            return result

        with patch("adminapi.dictionary_import_views.create_missing_taxonomies", side_effect=create_then_submit), \
             _as_role(OWNER) as headers:
            response = _post_json(self.client, f"/adminapi/dictionary/import/{job_id}/auto-create-taxonomies/", headers)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(DictionaryImportJob.objects.get(pk=job_id).status, DictionaryImportJob.STATUS_PENDING_REVIEW)


class ResumeClaimTest(_ImportBase):
    def _applying_job(self, minutes_ago):
        return DictionaryImportJob.objects.create(
            filename="x", tribe="tayal", payload=_minimal_bundle([{"name": "詞"}]),
            status=DictionaryImportJob.STATUS_APPLYING, uploaded_by="u", reviewed_by="r",
            reviewed_at=timezone.now() - timedelta(minutes=minutes_ago),
        )

    def test_recent_approval_is_refused(self):
        job = self._applying_job(1)
        with self.assertRaisesMessage(Exception, "分鐘前才核准"):
            call_command("resume_stuck_dictionary_import", str(job.pk), "--apply")
        job.refresh_from_db()
        self.assertEqual(job.status, DictionaryImportJob.STATUS_APPLYING)
        self.assertEqual(job.applied_by, "")

    def test_old_job_is_claimed_and_a_second_resume_needs_reclaim(self):
        job = self._applying_job(60)
        with redirect_stdout(io.StringIO()):
            call_command("resume_stuck_dictionary_import", str(job.pk), "--apply")
        job.refresh_from_db()
        self.assertEqual(job.status, DictionaryImportJob.STATUS_APPLIED)

    def test_already_claimed_job_needs_explicit_reclaim(self):
        job = self._applying_job(60)
        DictionaryImportJob.objects.filter(pk=job.pk).update(applied_by="resume:earlier")
        with self.assertRaisesMessage(Exception, "認領過"):
            call_command("resume_stuck_dictionary_import", str(job.pk), "--apply")

    def test_approval_loop_stops_when_the_job_was_claimed_elsewhere(self):
        from .dictionary_import.import_apply import ImportClaimLost, apply_import_job_rows
        job = self._applying_job(60)
        DictionaryImportJob.objects.filter(pk=job.pk).update(applied_by="resume:someone")
        report = {"items": [{"row": 0, "name": "詞", "action": "create", "word_id": None, "errors": [], "payload": {}}]}
        with self.assertRaises(ImportClaimLost):
            apply_import_job_rows(job, report)


class ProposeGuardsTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = Client()
        self.seed_tribe()
        self.word_id = self.seed_word(name="original")
        self.url = f"/adminapi/dictionary/words/{self.word_id}/propose/"

    def _propose(self, payload=None):
        body = {**_MINIMAL_WORD_PAYLOAD, "base_hash": _current_content_hash(self.word_id), **(payload or {})}
        with _as_role(EDITOR) as headers:
            return _post_json_raw(self.client, self.url, headers, body)

    def test_tribe_cannot_be_changed(self):
        self.seed_tribe(tribe_id="tribe-amis", name="阿美語", slug="amis")
        response = self._propose({"tribe_id": "tribe-amis"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("tribe_id", response.json()["errors"])

    def test_someone_elses_delete_draft_is_not_swallowed(self):
        DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_WORD, target_id=self.word_id, tribe="tayal",
            operation=DictionaryRevision.OPERATION_DELETE, payload={"unlink_references": False},
            status=DictionaryRevision.STATUS_DRAFT, created_by="test-uid",
        )
        response = self._propose()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(DictionaryRevision.objects.get().operation, DictionaryRevision.OPERATION_DELETE)

    def test_another_editors_draft_is_not_overwritten(self):
        DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_WORD, target_id=self.word_id, tribe="tayal",
            operation=DictionaryRevision.OPERATION_UPDATE, payload={"name": "別人的"},
            status=DictionaryRevision.STATUS_DRAFT, created_by="someone-else",
        )
        response = self._propose()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(DictionaryRevision.objects.get().payload, {"name": "別人的"})

    def test_own_update_draft_is_still_reused(self):
        first = self._propose()
        second = self._propose()
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(DictionaryRevision.objects.count(), 1)

    def test_submit_conflicting_with_another_pending_proposal_is_409_not_500(self):
        DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_WORD, target_id=self.word_id, tribe="tayal",
            operation=DictionaryRevision.OPERATION_UPDATE, payload={}, status=DictionaryRevision.STATUS_PENDING_REVIEW,
            created_by="someone-else",
        )
        draft = DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_WORD, target_id=self.word_id, tribe="tayal",
            operation=DictionaryRevision.OPERATION_UPDATE, payload={}, status=DictionaryRevision.STATUS_DRAFT,
            created_by="test-uid",
        )
        with _as_role(EDITOR) as headers:
            response = _post_json_raw(self.client, f"/adminapi/dictionary/revisions/{draft.pk}/submit/", headers)
        self.assertEqual(response.status_code, 409)

    def test_delete_draft_payload_is_validated_and_normalized(self):
        draft = DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_WORD, target_id=self.word_id, tribe="tayal",
            operation=DictionaryRevision.OPERATION_DELETE, payload={"unlink_references": False},
            status=DictionaryRevision.STATUS_DRAFT, created_by="test-uid",
        )
        with _as_role(EDITOR) as headers:
            bad = _put_json(self.client, f"/adminapi/dictionary/revisions/{draft.pk}/", headers, {"unlink_references": "maybe"})
            good = _put_json(self.client, f"/adminapi/dictionary/revisions/{draft.pk}/", headers,
                             {"unlink_references": True, "evil": "x"})
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(good.status_code, 200)
        draft.refresh_from_db()
        self.assertEqual(draft.payload, {"unlink_references": True})

    def test_approval_refuses_a_tribe_change_even_if_it_slipped_into_the_payload(self):
        self.seed_tribe(tribe_id="tribe-amis", name="阿美語", slug="amis")
        revision = DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_WORD, target_id=self.word_id, tribe="tayal",
            operation=DictionaryRevision.OPERATION_UPDATE, payload={**_MINIMAL_WORD_PAYLOAD, "tribe_id": "tribe-amis"},
            base_hash=_current_content_hash(self.word_id), status=DictionaryRevision.STATUS_PENDING_REVIEW,
            created_by="someone-else", submitted_by="someone-else",
        )
        with _as_role(REVIEWER) as headers:
            response = _post_json_raw(self.client, f"/adminapi/dictionary/revisions/{revision.pk}/approve/", headers)
        self.assertEqual(response.status_code, 400)
        db = connect_module.SessionLocal()
        try:
            self.assertEqual(db.query(m.Word.tribe_id).filter(m.Word.id == self.word_id).scalar(), "tribe-tayal")
        finally:
            db.close()


class ReconcileTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        self.seed_tribe()
        self.word_id = self.seed_word(name="original")

    def _stuck(self, **extra):
        return DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_WORD, tribe="tayal", status=DictionaryRevision.STATUS_APPROVED,
            reviewed_at=timezone.now() - timedelta(hours=1), created_by="u", payload={}, **extra,
        )

    def _run(self):
        with redirect_stdout(io.StringIO()):
            call_command("reconcile_stuck_dictionary_revisions", "--apply", "--min-age-minutes", "0")

    def test_update_that_was_never_applied_goes_back_to_pending_instead_of_being_marked_done(self):
        revision = self._stuck(
            target_id=self.word_id, operation=DictionaryRevision.OPERATION_UPDATE,
            base_hash=_current_content_hash(self.word_id),
        )
        self._run()
        revision.refresh_from_db()
        self.assertEqual(revision.status, DictionaryRevision.STATUS_PENDING_REVIEW)
        self.assertIsNone(revision.applied_at)

    def test_update_whose_content_changed_is_marked_applied(self):
        revision = self._stuck(
            target_id=self.word_id, operation=DictionaryRevision.OPERATION_UPDATE, base_hash="sha256:" + "0" * 64,
        )
        self._run()
        revision.refresh_from_db()
        self.assertIsNotNone(revision.applied_at)

    def test_create_uses_the_deterministic_id(self):
        from .dictionary_revision_service import revision_create_id
        revision = self._stuck(target_id="", operation=DictionaryRevision.OPERATION_CREATE)
        self._run()
        revision.refresh_from_db()
        # 固定 id 的詞條不存在：可能是舊式隨機 id 建立的，不自動退回（否則再核准一次會重複建立）
        self.assertEqual(revision.status, DictionaryRevision.STATUS_APPROVED)
        self.assertIsNone(revision.applied_at)

        revision2 = self._stuck(target_id="", operation=DictionaryRevision.OPERATION_CREATE)
        self.seed_word(revision_create_id(revision2.pk), "tribe-tayal", "已建立")
        self._run()
        revision2.refresh_from_db()
        self.assertIsNotNone(revision2.applied_at)
        self.assertEqual(revision2.target_id, revision_create_id(revision2.pk))


class FixCorruptedTimestampsDefaultsToPreviewTest(TestCase):
    def test_nothing_is_written_without_apply(self):
        doc = MagicMock()
        doc.id = "d1"
        doc.to_dict.return_value = {"createdAt": {"_seconds": 1700000000, "_nanoseconds": 0}}
        client = MagicMock()
        client.collection.return_value.stream.return_value = [doc]
        with patch("adminapi.firebase_ops.get_firestore_client", return_value=client), redirect_stdout(io.StringIO()):
            call_command("fix_corrupted_timestamps", "--collection", "c", "--field", "createdAt")
        doc.reference.update.assert_not_called()
        with patch("adminapi.firebase_ops.get_firestore_client", return_value=client), redirect_stdout(io.StringIO()):
            call_command("fix_corrupted_timestamps", "--collection", "c", "--field", "createdAt", "--apply")
        doc.reference.update.assert_called_once()


class PurgeUsageEventsTest(TestCase):
    def test_preview_then_apply(self):
        old = UsageEvent.objects.create(event_type="page_view")
        UsageEvent.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=500))
        UsageEvent.objects.create(event_type="page_view")
        with redirect_stdout(io.StringIO()):
            call_command("purge_usage_events")
        self.assertEqual(UsageEvent.objects.count(), 2)
        with redirect_stdout(io.StringIO()):
            call_command("purge_usage_events", "--apply")
        self.assertEqual(UsageEvent.objects.count(), 1)


class FinalizeClaimRaceTest(_ImportBase):
    def test_approve_does_not_overwrite_a_claim_made_just_before_finalizing(self):
        job = self._upload([{"name": "詞A", "explanations": [{"chinese_explanation": "x"}]}])
        with _as_role(EDITOR) as headers:
            _post_json(self.client, f"/adminapi/dictionary/import/{job['id']}/preflight/", headers)
            _post_json(self.client, f"/adminapi/dictionary/import/{job['id']}/submit/", headers)
        import adminapi.dictionary_import_views as views
        real = views.apply_import_job_rows

        def apply_then_get_claimed(job_obj, report):
            result = real(job_obj, report)
            DictionaryImportJob.objects.filter(pk=job_obj.pk).update(applied_by="resume:other")
            return result

        with patch.object(views, "apply_import_job_rows", side_effect=apply_then_get_claimed), \
             _as_role(REVIEWER) as headers:
            response = _post_json(self.client, f"/adminapi/dictionary/import/{job['id']}/approve/", headers)
        self.assertEqual(response.status_code, 409)
        stored = DictionaryImportJob.objects.get(pk=job["id"])
        self.assertEqual(stored.applied_by, "resume:other")
        self.assertEqual(stored.status, DictionaryImportJob.STATUS_APPLYING)
