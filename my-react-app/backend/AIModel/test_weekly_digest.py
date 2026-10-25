import io
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.core.management import call_command
from django.test import SimpleTestCase, TestCase

from AIModel import weekly_digest as wd
from AIModel.management.commands import generate_weekly_digests as cmd

NOW = datetime(2026, 10, 22, 15, 0, tzinfo=timezone.utc)


class FakeDoc:
    def __init__(self, data, doc_id="x"):
        self._data, self.id = data, doc_id
        self.exists = data is not None

    def to_dict(self):
        return self._data


class FakeCollection:
    def __init__(self, db, path):
        self.db, self.path = db, path

    def where(self, filter=None):  # noqa: A002 - 與 Firestore 的參數同名
        return self

    def select(self, fields):
        return self

    def order_by(self, field):
        return self

    def start_after(self, doc):
        clone = FakeCollection(self.db, self.path)
        clone.offset = doc.index + 1
        return clone

    def limit(self, n):
        clone = FakeCollection(self.db, self.path)
        clone.offset, clone.size = getattr(self, "offset", 0), n
        return clone

    def stream(self):
        start = getattr(self, "offset", 0)
        size = getattr(self, "size", None)
        docs = self.db.situations[start:start + size] if size else self.db.situations
        out = []
        for i, d in enumerate(docs):
            doc = FakeDoc(d)
            doc.index = start + i
            out.append(doc)
        return out

    def document(self, doc_id):
        return FakeDocRef(self.db, f"{self.path}/{doc_id}")


class FakeDocRef:
    def __init__(self, db, path):
        self.db, self.path = db, path

    def get(self, transaction=None):
        return FakeDoc(self.db.docs.get(self.path))

    def set(self, payload, merge=False):
        if self.path in self.db.fail_paths:
            raise RuntimeError("boom")
        self.db.docs[self.path] = {**self.db.docs.get(self.path, {}), **payload} if merge else payload
        self.db.writes.append(self.path)

    def collection(self, name):
        return FakeCollection(self.db, f"{self.path}/{name}")


class FakeTransaction:
    """只模擬讀寫介面；真正的原子性由 Firestore 保證，測試的是 transaction 裡的判斷邏輯。"""

    def set(self, ref, payload):
        ref.set(payload)

    def update(self, ref, payload):
        ref.set(payload, merge=True)


def fake_in_transaction(db, work):
    return work(FakeTransaction())


class FakeDB:
    def __init__(self, situations=(), docs=None, fail_paths=()):
        self.situations, self.docs, self.fail_paths, self.writes = list(situations), dict(docs or {}), set(fail_paths), []

    def collection(self, name):
        return FakeCollection(self, name)


def situation(uid, days_ago=1, correct=(True, False)):
    return {
        "userId": uid, "answeredAt": NOW - timedelta(days=days_ago),
        "results": [{"isCorrect": c} for c in correct],
    }


class PureLogicTests(SimpleTestCase):
    def test_week_id_uses_taipei_iso_week(self):
        self.assertEqual(wd.week_id(NOW), "2026-W43")

    def test_custom_id_is_valid_and_stable_for_odd_uids(self):
        for uid in ("a" * 128, "uid with space/和斜線"):
            cid = wd.custom_id_for(uid)
            self.assertRegex(cid, r"^[A-Za-z0-9_-]{1,64}$")
            self.assertEqual(cid, wd.custom_id_for(uid))
        self.assertNotEqual(wd.custom_id_for("a"), wd.custom_id_for("b"))

    def test_activity_aggregates_per_student_and_counts_days(self):
        db = FakeDB(situations=[situation("u1", 1), situation("u1", 3, (True, True, True)), situation("u2", 2, (True,))])
        activity = wd.collect_week_activity(db, NOW - timedelta(days=7))
        self.assertEqual(activity["u1"], {"attempts": 2, "questions": 5, "correct": 4, "active_days": 2})
        self.assertEqual(activity["u2"]["questions"], 1)

    def test_scan_pages_through_everything_and_stops_at_the_cap(self):
        db = FakeDB(situations=[situation(f"u{i % 7}") for i in range(2500)])
        activity = wd.collect_week_activity(db, NOW - timedelta(days=7))
        self.assertEqual(sum(a["attempts"] for a in activity.values()), 2500)
        with self.assertRaises(wd.ScanLimitExceeded):
            wd.collect_week_activity(db, NOW - timedelta(days=7), max_scan=1000)

    def test_blank_submissions_do_not_count_as_activity(self):
        db = FakeDB(situations=[situation("blank", 1, ()), situation("real", 1)])
        self.assertEqual(list(wd.collect_week_activity(db, NOW - timedelta(days=7))), ["real"])

    def test_activity_ignores_malformed_records(self):
        db = FakeDB(situations=[{"userId": "", "answeredAt": NOW}, {"userId": "u1"}, {"answeredAt": NOW}, situation("u3")])
        self.assertEqual(list(wd.collect_week_activity(db, NOW)), ["u3"])

    def test_review_words_ranked_cleaned_and_limited(self):
        errors = {f"w{i}": i for i in range(1, 9)}
        errors.update({"bad\nline": 2, "zero": 0, "neg": -1, "str": "3"})
        words = wd.review_words({"user_errors": errors})
        self.assertEqual(len(words), wd.MAX_REVIEW_WORDS)
        self.assertEqual(words[0], {"word": "w8", "wrong": 8})
        self.assertNotIn("zero", [w["word"] for w in words])
        self.assertEqual(wd.review_words(None), [])
        self.assertEqual(wd.review_words({"user_errors": "oops"}), [])

    def test_accept_summary_rejects_any_quantity_expression(self):
        stats = {"attempts": 3, "questions": 10, "correct": 7, "active_days": 2}
        ok = "這一週你一直有練習，保持這個節奏很好。"
        self.assertEqual(wd.accept_summary(ok, stats, []), ok)
        for bad in ("你答對了 7 題", "答對七題", "正確率百分之九十", "答對率 7%", "７題", "練習了兩次", "共三天", ""):
            self.assertIsNone(wd.accept_summary(bad, stats, []), bad)
        self.assertIsNone(wd.accept_summary("字" * 201, stats, []))
        self.assertIsNone(wd.accept_summary(None, stats, []))

    def test_user_message_escapes_angle_brackets_and_request_shape(self):
        stats = {"attempts": 1, "questions": 2, "correct": 1, "active_days": 1}
        request = wd.build_batch_request("u1", stats, [])
        self.assertEqual(request["custom_id"], wd.custom_id_for("u1"))
        self.assertIn("output_config", request["params"])
        content = request["params"]["messages"][0]["content"]
        self.assertEqual(content.count("</week_stats>"), 1)


def fake_message(text, stop_reason="end_turn"):
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)], stop_reason=stop_reason, usage=None)


def batch_entry(uid, text=None, result_type="succeeded", stop_reason="end_turn"):
    result = SimpleNamespace(type=result_type, message=fake_message(text, stop_reason) if text is not None else None)
    return SimpleNamespace(custom_id=wd.custom_id_for(uid), result=result)


STATS = {"attempts": 2, "questions": 4, "correct": 3, "active_days": 2}


class FetchSummariesTests(SimpleTestCase):
    def _planned(self, *uids):
        return [(u, STATS, []) for u in uids]

    def test_failure_of_one_student_does_not_affect_others(self):
        good = json.dumps({"summary": "這週持續練習，保持下去。"})
        client = MagicMock()
        client.messages.batches.results.return_value = [
            batch_entry("ok", good),
            batch_entry("errored", result_type="errored"),
            batch_entry("expired", result_type="expired"),
            batch_entry("refused", good, stop_reason="refusal"),
            batch_entry("badjson", "not json"),
            batch_entry("fake_numbers", json.dumps({"summary": "答對 999 題"})),
        ]
        planned = self._planned("ok", "errored", "expired", "refused", "badjson", "fake_numbers", "missing")
        with patch("config.llm._record_usage"):
            summaries = cmd.fetch_summaries(client, "batch1", planned)
        self.assertEqual(list(summaries), ["ok"])


class WriteAllTests(SimpleTestCase):
    def test_template_used_when_no_model_summary_and_write_failure_isolated(self):
        db = FakeDB(fail_paths={"users/bad/weeklyDigest/current"})
        planned = [("u1", STATS, []), ("bad", STATS, []), ("u2", STATS, [{"word": "w", "wrong": 2}])]
        with patch("AIModel.weekly_digest._server_timestamp", return_value="ts"):
            counts = cmd.write_all(db, planned, {"u1": "模型寫的"}, NOW)
        self.assertEqual(counts, {"model": 1, "template": 1, "failed": 1, "skipped": 0})
        self.assertEqual(db.docs["users/u1/weeklyDigest/current"]["summarySource"], "model")
        written = db.docs["users/u2/weeklyDigest/current"]
        self.assertEqual(written["summarySource"], "template")
        self.assertEqual(written["reviewWords"], [{"word": "w", "wrong": 2}])
        self.assertIsNone(written["dismissedAt"])
        self.assertEqual(written["weekId"], "2026-W43")


class PlanStudentsTests(SimpleTestCase):
    def test_inactive_students_never_planned_and_existing_week_skipped(self):
        db = FakeDB(
            situations=[situation("active"), situation("done_already")],
            docs={"users/done_already/weeklyDigest/current": {"weekId": "2026-W43"}, "users/active": {"user_errors": {"w": 2}}},
        )
        planned = cmd.plan_students(db, NOW, 100)
        self.assertEqual([p[0] for p in planned], ["active"])
        self.assertEqual(planned[0][2], [{"word": "w", "wrong": 2}])

    def test_cap_rotates_between_weeks_instead_of_starving_the_same_students(self):
        db = FakeDB(situations=[situation(f"u{i}") for i in range(30)])
        week1 = {p[0] for p in cmd.plan_students(db, NOW, 5)}
        week2 = {p[0] for p in cmd.plan_students(db, NOW + timedelta(days=7), 5)}
        self.assertEqual(len(week1), 5)
        self.assertNotEqual(week1, week2)

    def test_max_users_caps_the_batch(self):
        db = FakeDB(situations=[situation(f"u{i}") for i in range(5)])
        self.assertEqual(len(cmd.plan_students(db, NOW, 3)), 3)


class CommandTests(TestCase):
    def _run(self, *args, db=None, client=None, enabled=True):
        out = io.StringIO()
        with patch.object(cmd, "digest_enabled", return_value=enabled), \
                patch.object(cmd, "budget_exceeded", return_value=False), \
                patch("AIModel.weekly_digest._client", return_value=db or FakeDB()), \
                patch("AIModel.weekly_digest._in_transaction", fake_in_transaction), \
                patch("config.llm.get_llm_client", return_value=client or MagicMock()), \
                patch("config.llm._record_usage"), \
                patch("AIModel.weekly_digest._server_timestamp", return_value="ts"),                 patch.object(cmd, "datetime", wraps=datetime) as fake_datetime:
            # 指令用現在時間決定「這週」；測試的資料與租約鍵都寫死在 2026-W43，所以固定時鐘，否則換週後整組測試失效
            fake_datetime.now.return_value = NOW
            call_command("generate_weekly_digests", *args, stdout=out)
        return out.getvalue()

    def test_failed_expired_and_refused_results_are_recorded_too(self):
        client = MagicMock()
        client.messages.batches.results.return_value = [
            batch_entry("a", result_type="errored"), batch_entry("b", result_type="expired"),
            batch_entry("c", result_type="canceled"), batch_entry("d", json.dumps({"summary": "x"}), stop_reason="refusal"),
        ]
        with patch("config.llm._record_usage") as record:
            cmd.fetch_summaries(client, "b", [(u, STATS, []) for u in "abcd"])
        self.assertEqual([c.kwargs["status"] for c in record.call_args_list], ["error", "expired", "cancelled", "refusal"])

    def test_scan_over_the_cap_generates_nothing(self):
        db, client = FakeDB(situations=[situation(f"u{i}") for i in range(1500)]), MagicMock()
        text = self._run("--max-scan", "1000", db=db, client=client)
        self.assertIn("不產生摘要", text)
        client.messages.batches.create.assert_not_called()

    def test_flag_off_does_nothing(self):
        client = MagicMock()
        text = self._run(db=FakeDB(situations=[situation("u1")]), client=client, enabled=False)
        self.assertIn("未開啟", text)
        client.messages.batches.create.assert_not_called()

    def test_dry_run_never_calls_api_or_writes(self):
        db, client = FakeDB(situations=[situation("u1")]), MagicMock()
        text = self._run("--dry-run", db=db, client=client)
        self.assertIn("1 位", text)
        client.messages.batches.create.assert_not_called()
        self.assertEqual(db.writes, [])

    def test_no_activity_means_no_batch_and_no_digest(self):
        db, client = FakeDB(situations=[]), MagicMock()
        self._run(db=db, client=client)
        client.messages.batches.create.assert_not_called()
        self.assertFalse([w for w in db.writes if "weeklyDigest" in w])

    def test_full_run_writes_model_summary_for_active_student(self):
        db, client = FakeDB(situations=[situation("u1")]), MagicMock()
        client.messages.batches.create.return_value = SimpleNamespace(id="b1")
        client.messages.batches.retrieve.return_value = SimpleNamespace(id="b1", processing_status="ended")
        client.messages.batches.results.return_value = [batch_entry("u1", json.dumps({"summary": "這週很認真練習。"}))]
        text = self._run(db=db, client=client)
        self.assertIn("模型摘要 1", text)
        self.assertEqual(db.docs["users/u1/weeklyDigest/current"]["summarySource"], "model")

    def test_submit_failure_falls_back_to_templates_for_everyone(self):
        db, client = FakeDB(situations=[situation("u1"), situation("u2")]), MagicMock()
        client.messages.batches.create.side_effect = RuntimeError("api down")
        text = self._run(db=db, client=client)
        self.assertIn("固定樣板 2", text)

    def test_timeout_cancels_batch_and_still_writes_templates(self):
        db, client = FakeDB(situations=[situation("u1")]), MagicMock()
        client.messages.batches.create.return_value = SimpleNamespace(id="b9")
        client.messages.batches.retrieve.side_effect = [
            SimpleNamespace(id="b9", processing_status="in_progress"),
            SimpleNamespace(id="b9", processing_status="ended"),
        ]
        client.messages.batches.results.return_value = []
        with patch.object(cmd.time, "sleep"), patch.object(cmd.time, "monotonic", side_effect=[0, 0, 10**9]):
            text = self._run("--wait-minutes", "1", db=db, client=client)
        client.messages.batches.cancel.assert_called_once_with("b9")
        self.assertIn("固定樣板 1", text)

    def test_second_overlapping_run_is_skipped_by_the_lease(self):
        db, client = FakeDB(situations=[situation("u1")]), MagicMock()
        db.docs["aiDigestJobs/2026-W43"] = {"startedAt": NOW, "finishedAt": None}
        text = self._run(db=db, client=client)
        self.assertIn("已有另一個執行在跑", text)
        client.messages.batches.create.assert_not_called()

    def test_stale_lease_can_be_taken_over_and_is_released(self):
        db, client = FakeDB(situations=[]), MagicMock()
        db.docs["aiDigestJobs/2026-W43"] = {"startedAt": NOW - timedelta(hours=7), "finishedAt": None}
        self._run(db=db, client=client)
        self.assertIsNotNone(db.docs["aiDigestJobs/2026-W43"]["finishedAt"])

    def test_lease_records_its_owner_and_only_that_owner_can_release_it(self):
        db = FakeDB()
        with patch("AIModel.weekly_digest._in_transaction", fake_in_transaction):
            first = wd.acquire_lease(db, "2026-W43", NOW)
            self.assertTrue(first)
            self.assertEqual(db.docs["aiDigestJobs/2026-W43"]["owner"], first)
            self.assertIsNone(wd.acquire_lease(db, "2026-W43", NOW))             # 有效租約拿不到
            # 租期過了被別人接手；舊執行者晚到的釋放不能把新執行者的租約標成已結束
            later = NOW + timedelta(hours=wd.LEASE_HOURS + 1)
            second = wd.acquire_lease(db, "2026-W43", later)
            self.assertTrue(second)
            self.assertNotEqual(first, second)
            self.assertFalse(wd.release_lease(db, "2026-W43", first, later))
            self.assertIsNone(db.docs["aiDigestJobs/2026-W43"]["finishedAt"])
            self.assertIsNone(wd.acquire_lease(db, "2026-W43", later))           # 新租約仍有效，第三個執行者進不來
            self.assertTrue(wd.release_lease(db, "2026-W43", second, later))
            self.assertIsNotNone(db.docs["aiDigestJobs/2026-W43"]["finishedAt"])

    def test_a_failing_lease_release_is_logged_and_does_not_fail_the_run(self):
        db, client = FakeDB(situations=[situation("u1")]), MagicMock()
        client.messages.batches.create.return_value = SimpleNamespace(id="b5")
        client.messages.batches.retrieve.return_value = SimpleNamespace(id="b5", processing_status="ended")
        client.messages.batches.results.return_value = [batch_entry("u1", json.dumps({"summary": "這週很認真練習。"}))]
        with patch("AIModel.weekly_digest.release_lease", side_effect=ValueError("Failed to commit transaction in 5 attempts.")):
            text = self._run(db=db, client=client)
        self.assertIn("模型摘要 1", text)                                          # 摘要照常寫入，釋放失敗只記錄

    def test_lease_contention_that_exhausts_the_retries_counts_as_not_acquired(self):
        def exhausted(db, work):
            raise ValueError("Failed to commit transaction in 5 attempts.")

        with patch("AIModel.weekly_digest._in_transaction", exhausted):
            self.assertIsNone(wd.acquire_lease(FakeDB(), "2026-W43", NOW))

    def test_transient_poll_errors_are_retried_and_the_run_still_gets_model_summaries(self):
        db, client = FakeDB(situations=[situation("u1")]), MagicMock()
        client.messages.batches.create.return_value = SimpleNamespace(id="b1")
        client.messages.batches.retrieve.side_effect = [
            RuntimeError("429"), RuntimeError("timeout"), SimpleNamespace(id="b1", processing_status="ended"),
        ]
        client.messages.batches.results.return_value = [batch_entry("u1", json.dumps({"summary": "這週很認真練習。"}))]
        with patch.object(cmd.time, "sleep"):
            text = self._run(db=db, client=client)
        self.assertIn("模型摘要 1", text)
        client.messages.batches.cancel.assert_not_called()

    def test_poll_errors_that_never_recover_cancel_the_batch_and_write_templates(self):
        db, client = FakeDB(situations=[situation("u1"), situation("u2")]), MagicMock()
        client.messages.batches.create.return_value = SimpleNamespace(id="b2")
        client.messages.batches.retrieve.side_effect = RuntimeError("down")
        with patch.object(cmd.time, "sleep"):
            text = self._run(db=db, client=client)
        client.messages.batches.cancel.assert_called_once_with("b2")
        client.messages.batches.results.assert_not_called()
        self.assertIn("固定樣板 2", text)
        self.assertIsNotNone(db.docs["aiDigestJobs/2026-W43"]["finishedAt"])      # 租約仍然釋放

    def test_poll_failure_and_cancel_failure_still_end_with_templates(self):
        db, client = FakeDB(situations=[situation("u1")]), MagicMock()
        client.messages.batches.create.return_value = SimpleNamespace(id="b3")
        client.messages.batches.retrieve.side_effect = RuntimeError("down")
        client.messages.batches.cancel.side_effect = RuntimeError("cancel down")
        with patch.object(cmd.time, "sleep"):
            text = self._run(db=db, client=client)
        self.assertIn("固定樣板 1", text)

    def test_status_errors_while_waiting_for_the_cancel_do_not_abort_the_run(self):
        db, client = FakeDB(situations=[situation("u1")]), MagicMock()
        client.messages.batches.create.return_value = SimpleNamespace(id="b4")
        client.messages.batches.retrieve.side_effect = [
            SimpleNamespace(id="b4", processing_status="in_progress"),
            RuntimeError("a"), RuntimeError("b"), RuntimeError("c"),
        ]
        client.messages.batches.results.return_value = []
        with patch.object(cmd.time, "sleep"), patch.object(cmd.time, "monotonic", side_effect=[0, 0, 10**9]):
            text = self._run("--wait-minutes", "1", db=db, client=client)
        client.messages.batches.cancel.assert_called_once_with("b4")
        self.assertIn("固定樣板 1", text)

    def test_budget_check_failure_means_no_run(self):
        db, client = FakeDB(situations=[situation("u1")]), MagicMock()
        with patch.object(cmd, "digest_enabled", return_value=True),                 patch("adminapi.ai_budget.evaluate", side_effect=RuntimeError("db down")),                 patch("AIModel.weekly_digest._client", return_value=db):
            call_command("generate_weekly_digests", stdout=io.StringIO())
        client.messages.batches.create.assert_not_called()
        self.assertEqual(db.writes, [])

    def test_existing_digest_for_this_week_is_not_overwritten_or_undismissed(self):
        mine = {"weekId": "2026-W43", "dismissedAt": "closed"}
        db = FakeDB(docs={"users/u1/weeklyDigest/current": mine})
        with patch("AIModel.weekly_digest._server_timestamp", return_value="ts"):
            counts = cmd.write_all(db, [("u1", STATS, [])], {}, NOW)
        self.assertEqual(counts["skipped"], 1)
        self.assertEqual(db.docs["users/u1/weeklyDigest/current"], mine)
