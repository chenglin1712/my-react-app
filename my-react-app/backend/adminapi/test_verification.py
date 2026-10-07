"""待專家驗證佇列（M5）：服務層、API、CSV 匯出入、enqueue 指令，以及「不寫回辭典」的邊界測試。"""
import ast
import csv
import hashlib
import io
import json
import re
import tempfile
from contextlib import contextmanager
from pathlib import Path
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError
from django.http import JsonResponse
from django.test import Client, TestCase
from django.test.utils import override_settings

from adminapi import verification_service as svc
from adminapi.management.commands import enqueue_verification_items as enq
from adminapi.models import (
    AuditLog, FeatureFlag, QuizChoiceItem, VerificationItem, VerificationObservation, VerificationReview,
)
from adminapi.models.verification import KIND_MORPH_ANALYSIS, KIND_UNMATCHED_FORM
from config.roles import ADMIN, ANALYST, EDITOR, OWNER, REVIEWER

ROOT = Path(__file__).resolve().parent
OBS = svc.ObservationInput("coverage", 3, "label-a", 12, 8, 50)
BAD_OBS = [svc.ObservationInput("weird", 3, "l", 1, 1, 5), svc.ObservationInput("coverage", 0, "l", 1, 1, 5),
           svc.ObservationInput("coverage", 3, "", 1, 1, 5), svc.ObservationInput("coverage", 3, "l", -1, 0, 5),
           svc.ObservationInput("coverage", 3, "l", 1, 2, 5), svc.ObservationInput("coverage", 3, "l", 1, 1, 0),
           svc.ObservationInput("coverage", 3, "l", True, 0, 5), svc.ObservationInput("coverage", 3, "l", "1", 0, 5)]
PROPOSAL = {"predicted_root": "filo", "rule": "ma-", "gold_roots": ["filo", "alaw"]}


@contextmanager
def _as(role, uid="uid-1"):
    with override_settings(AUTH_DEV_BYPASS=False):
        with mock.patch("core.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": uid}
            if role is not None:
                decoded["role"] = role
            with mock.patch("firebase_admin.auth.verify_id_token", return_value=decoded):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _enable(value=True):
    FeatureFlag.objects.update_or_create(key=svc.FLAG_KEY, defaults={"label": "x", "description": "x", "enabled": value})


def _item(form="baqi", kind=KIND_UNMATCHED_FORM, tribe="kavalan", proposal=None, obs=OBS):
    return svc.upsert_item(tribe, kind, form, proposal, "system:test", obs)[0]


def _post(client, url, headers, payload):
    return client.post(url, data=json.dumps(payload), content_type="application/json", **headers)


def _annotated(**kw):
    return svc.annotate_items(VerificationItem.objects.filter(**kw)).first()


def _review(item, subject, verdict, correction="", rtype="staff"):
    return VerificationReview.objects.create(
        item=item, reviewer_type=rtype, reviewer_subject=subject, reviewer_label=subject, entered_by_uid="u", verdict=verdict,
        correction=correction, correction_norm=svc.correction_norm(correction))


# ---------------------------------------------------------------------------
# 規範化與 key
# ---------------------------------------------------------------------------

class KeyTests(TestCase):
    def test_golden_vector_pins_the_canonical_form_and_the_hash(self):
        payload = svc.canonical_key_payload("kavalan", "unmatched_form", "baqi", None)
        self.assertEqual(payload, '{"form":"baqi","kind":"unmatched_form","proposal":null,"tribe":"kavalan"}')
        # 寫死的期望值：之後任何重構若讓 key 改變，所有既有項目的冪等性就壞了，這個測試必須失敗
        self.assertEqual(svc.item_key("kavalan", "unmatched_form", "baqi", None),
                         "fb54e0400ba0bf70c7837a1af9eb5065143465cf6195119657da6ad712b1317f")
        morph = {"predicted_root": "ala", "rule": "ma-", "gold_roots": ["mala", "ala"]}
        self.assertEqual(svc.item_key("amis", "morph_analysis", "maala", svc.validate_proposal("morph_analysis", morph)),
                         "83d2996be3cd1ff80e0547527dacd9f38d55c32290690797e3f358c60d1e7a85")

    def test_key_ignores_source_and_proposal_key_order_but_not_content(self):
        a = _item("baqi", obs=svc.ObservationInput("coverage", 3, "a", 1, 1, 5))
        b = _item("baqi", obs=svc.ObservationInput("coverage", 4, "b", 9, 9, 5))
        self.assertEqual(a.pk, b.pk)
        p1 = {"predicted_root": "x", "rule": "ma-", "gold_roots": ["b", "a", "a"]}
        p2 = {"gold_roots": ["a", "b"], "rule": "ma-", "predicted_root": "x"}
        self.assertEqual(_item("d", KIND_MORPH_ANALYSIS, proposal=p1).pk, _item("d", KIND_MORPH_ANALYSIS, proposal=p2).pk)
        self.assertNotEqual(_item("d", KIND_MORPH_ANALYSIS, proposal={**p2, "rule": "pa-"}).pk, _item("d", KIND_MORPH_ANALYSIS, proposal=p2).pk)

    def test_form_is_only_trimmed_never_case_folded_or_whitespace_collapsed(self):
        self.assertEqual(svc.item_key("kavalan", "unmatched_form", "baqi", None), _item("  baqi  ").key)
        self.assertNotEqual(_item("Baqi").pk, _item("baqi").pk)
        self.assertNotEqual(_item("a b").pk, _item("a  b").pk)

    def test_tribe_and_kind_make_different_items(self):
        self.assertNotEqual(_item("x", tribe="kavalan").pk, _item("x", tribe="tayal").pk)

    def test_invalid_input_is_rejected(self):
        for kwargs in ({"tribe": "klingon"}, {"form": ""}, {"form": "a\nb"}, {"form": "x" * 201}, {"form": "a\x00b"}):
            with self.assertRaises(svc.ValidationFailed):
                _item(**{"form": "ok", **kwargs}) if "form" not in kwargs else _item(**kwargs)
        with self.assertRaises(svc.ValidationFailed):
            svc.upsert_item("kavalan", "weird", "x", None, "s", OBS)
        with self.assertRaises(svc.ValidationFailed):
            _item("x", KIND_UNMATCHED_FORM, proposal={"predicted_root": "a"})
        for bad in (None, {}, {"predicted_root": "a", "rule": "b"}, {**PROPOSAL, "extra": 1}, {**PROPOSAL, "gold_roots": []},
                    {**PROPOSAL, "gold_roots": "x"}, {**PROPOSAL, "gold_roots": [1]}, {**PROPOSAL, "predicted_root": ""}):
            with self.assertRaises(svc.ValidationFailed):
                _item("x", KIND_MORPH_ANALYSIS, proposal=bad)

    def test_numbers_beyond_the_database_column_ranges_are_rejected_by_the_service(self):
        too_big = [svc.ObservationInput("coverage", 3, "l", svc.INT32_MAX + 1, 0, 5),
                   svc.ObservationInput("coverage", 3, "l", 5, 5, svc.INT32_MAX + 1),
                   svc.ObservationInput("coverage", svc.INT16_MAX + 1, "l", 5, 5, 5)]
        for bad in too_big:
            with self.assertRaises(svc.ValidationFailed, msg=bad):
                svc.validate_candidate("kavalan", KIND_UNMATCHED_FORM, "x", None, bad)
        ok = svc.ObservationInput("coverage", svc.INT16_MAX, "l", svc.INT32_MAX, svc.INT32_MAX, svc.INT32_MAX)
        self.assertEqual(svc.validate_candidate("kavalan", KIND_UNMATCHED_FORM, "x", None, ok).obs.report_version, svc.INT16_MAX)

    def test_an_empty_label_is_rejected_by_the_database_too(self):
        from django.db import transaction
        item = _item("x")
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                VerificationObservation.objects.create(item=item, source="coverage", report_version=1, report_label="",
                                                       occurrence_count=1, sentence_count=1, list_size=1)

    def test_observation_input_is_validated_by_the_service_and_by_database_constraints(self):
        for bad in BAD_OBS:
            with self.assertRaises(svc.ValidationFailed, msg=bad):
                svc.validate_candidate("kavalan", KIND_UNMATCHED_FORM, "x", None, bad)
        from django.db import transaction
        item = _item("x")
        for kwargs in ({"source": "weird"}, {"report_version": 0}, {"list_size": 0}, {"sentence_count": 99, "occurrence_count": 1}):
            data = dict(item=item, source="coverage", report_version=3, report_label="db-check", occurrence_count=5,
                        sentence_count=1, list_size=5)
            data.update(kwargs)
            with self.assertRaises(IntegrityError):
                with transaction.atomic():
                    VerificationObservation.objects.create(**data)

    def test_re_enqueue_updates_the_observation_and_keeps_one_item(self):
        _item("baqi")
        svc.upsert_item("kavalan", KIND_UNMATCHED_FORM, "baqi", None, "s", svc.ObservationInput("coverage", 3, "label-a", 99, 7, 50))
        self.assertEqual(VerificationItem.objects.count(), 1)
        obs = VerificationObservation.objects.get()
        self.assertEqual((obs.occurrence_count, obs.sentence_count), (99, 7))
        svc.upsert_item("kavalan", KIND_UNMATCHED_FORM, "baqi", None, "s", svc.ObservationInput("coverage", 3, "label-b", 5, 2, 50))
        self.assertEqual(VerificationObservation.objects.count(), 2)

    def test_observation_has_no_free_text_or_sentence_fields(self):
        names = {f.name for f in VerificationObservation._meta.get_fields()}
        self.assertFalse(names & {"context", "sentence", "sentences", "sentence_ids", "excerpt", "text"})
        self.assertEqual({"occurrence_count", "sentence_count", "list_size"} - names, set())


# ---------------------------------------------------------------------------
# 狀態推導
# ---------------------------------------------------------------------------

class StateTests(TestCase):
    def state(self, item):
        i = _annotated(pk=item.pk)
        return svc.review_state(i.opinion_count, i.agree_count, i.disagree_count, i.correction_variants)

    def test_no_opinions_is_awaiting(self):
        self.assertEqual(self.state(_item()), svc.STATE_AWAITING)

    def test_uncertain_only_never_forms_a_conclusion_or_a_conflict(self):
        item = _item()
        _review(item, "a", "uncertain")
        _review(item, "b", "uncertain")
        self.assertEqual(self.state(item), svc.STATE_OPINIONS)

    def test_agree_with_uncertain_is_not_a_conflict(self):
        item = _item()
        _review(item, "a", "agree")
        _review(item, "b", "uncertain")
        self.assertEqual(self.state(item), svc.STATE_OPINIONS)

    def test_agree_and_disagree_conflict(self):
        item = _item()
        _review(item, "a", "agree")
        _review(item, "b", "disagree")
        self.assertEqual(self.state(item), svc.STATE_CONFLICT)

    def test_same_verdict_with_different_corrections_conflicts(self):
        item = _item()
        _review(item, "a", "disagree", "baqi")
        _review(item, "b", "disagree", "baqiy")
        self.assertEqual(self.state(item), svc.STATE_CONFLICT)

    def test_corrections_equal_after_normalization_do_not_conflict(self):
        item = _item()
        _review(item, "a", "disagree", "Baqi")
        _review(item, "b", "disagree", "  baqi ")
        self.assertEqual(self.state(item), svc.STATE_OPINIONS)

    def test_a_single_correction_is_not_a_conflict(self):
        item = _item()
        _review(item, "a", "disagree", "baqi")
        _review(item, "b", "disagree", "")
        self.assertEqual(self.state(item), svc.STATE_OPINIONS)

    def test_changing_my_own_review_changes_the_state_immediately(self):
        item = _item()
        r = _review(item, "a", "agree")
        _review(item, "b", "disagree")
        self.assertEqual(self.state(item), svc.STATE_CONFLICT)
        r.verdict = "disagree"
        r.save()
        self.assertEqual(self.state(item), svc.STATE_OPINIONS)

    def test_casefold_expansion_never_overflows_the_normalized_column(self):
        # 200 個 ß 經 casefold 變成 400 個字元；correction_norm 的上限必須容得下（PostgreSQL 的 varchar 會嚴格拒絕）
        item = _item()
        fields = svc.parse_review_fields({"verdict": "disagree", "correction": "ß" * 200})
        self.assertEqual(len(fields["correction_norm"]), 400)
        max_len = VerificationReview._meta.get_field("correction_norm").max_length
        self.assertGreaterEqual(max_len, 3 * svc.MAX_CORRECTION)
        for ch in ("ß", "İ", "ŉ", "ǰ", "ΐ", "ﬃ"):
            self.assertLessEqual(len(svc.correction_norm(ch * svc.MAX_CORRECTION)), max_len, ch)
        svc.save_review(_Req(), {"uid": "u"}, item, fields, reviewer_type="staff", subject="u", label="l", entered_by="u")
        self.assertEqual(VerificationReview.objects.get().correction, "ß" * 200)

    def test_database_filter_matches_the_python_state_for_every_item(self):
        items = {"w0": _item("w0"), "w1": _item("w1"), "w2": _item("w2"), "w3": _item("w3"), "w4": _item("w4")}
        _review(items["w1"], "a", "agree")
        _review(items["w2"], "a", "agree")
        _review(items["w2"], "b", "disagree")
        _review(items["w3"], "a", "uncertain")
        _review(items["w4"], "a", "disagree", "x")
        _review(items["w4"], "b", "disagree", "y")
        for state in svc.STATES:
            via_db = {i.form for i in svc.filter_by_state(svc.annotate_items(VerificationItem.objects.all()), state)}
            via_py = {name for name, it in items.items() if self.state(it) == state}
            self.assertEqual(via_db, via_py, state)
        with self.assertRaises(svc.ValidationFailed):
            svc.filter_by_state(svc.annotate_items(VerificationItem.objects.all()), "verified")

    def test_no_state_name_claims_verification(self):
        for name in svc.STATES:
            self.assertNotRegex(name.lower(), r"verif|valid|approv|confirm")


# ---------------------------------------------------------------------------
# CSV 匯出
# ---------------------------------------------------------------------------

class ExportTests(TestCase):
    def test_csv_safe_blocks_formula_prefixes_including_hidden_ones(self):
        for bad in ("=1+1", "+1", "-1", "@SUM(A1)", "\t=1", "\r=1", "\tabc", "\rabc", "  =1", " =1", "\x00=1"):
            self.assertTrue(svc.csv_safe(bad).startswith("'"), repr(bad))
        for good in ("baqi", "a=b", "", "1.5", "x-y"):
            self.assertEqual(svc.csv_safe(good), good)
        self.assertEqual(svc.csv_safe(5), "5")
        self.assertEqual(svc.csv_safe(None), "")

    def test_template_has_bom_fixed_columns_and_blank_input_columns(self):
        _item("baqi")
        text = svc.export_template_csv(svc.annotate_items(VerificationItem.objects.all()).prefetch_related("observations"))
        self.assertTrue(text.startswith("﻿"))
        rows = list(csv.reader(io.StringIO(text[1:])))
        self.assertEqual(rows[0], svc.EXPORT_COLUMNS)
        row = dict(zip(rows[0], rows[1]))
        self.assertEqual((row["tribe"], row["form"], row["occurrence_count"], row["review_state"]), ("kavalan", "baqi", "12", svc.STATE_AWAITING))
        self.assertEqual([row[c] for c in ("reviewer", "verdict", "correction", "dialect", "notes")], [""] * 5)

    def test_untrusted_strings_are_protected_but_numbers_are_not(self):
        _item("=cmd|' /C calc'!A0")
        _item("tail", KIND_MORPH_ANALYSIS, proposal={"predicted_root": "@x", "rule": "-ma", "gold_roots": ["+y"]})
        text = svc.export_template_csv(svc.annotate_items(VerificationItem.objects.all()).prefetch_related("observations"))
        rows = [dict(zip(svc.EXPORT_COLUMNS, r)) for r in list(csv.reader(io.StringIO(text[1:])))[1:]]
        forms = {r["form"] for r in rows}
        self.assertIn("'=cmd|' /C calc'!A0", forms)
        morph = next(r for r in rows if r["form"] == "tail")
        self.assertEqual((morph["predicted_root"], morph["rule"], morph["gold_roots"]), ("'@x", "'-ma", "'+y"))
        self.assertTrue(all(r["occurrence_count"] == "12" for r in rows))

    def test_export_never_contains_any_opinion_content(self):
        item = _item("baqi")
        VerificationReview.objects.create(item=item, reviewer_type="staff", reviewer_subject="s", reviewer_label="SECRET-LABEL",
                                          entered_by_uid="u", verdict="agree", notes="SECRET-NOTES", correction="SECRET-FIX")
        text = svc.export_template_csv(svc.annotate_items(VerificationItem.objects.all()).prefetch_related("observations"))
        for secret in ("SECRET-LABEL", "SECRET-NOTES", "SECRET-FIX"):
            self.assertNotIn(secret, text)
        self.assertEqual(dict(zip(svc.EXPORT_COLUMNS, list(csv.reader(io.StringIO(text[1:])))[1]))["opinion_count"], "1")

    def test_order_is_deterministic_newest_first_with_id_tiebreak(self):
        for f in ("a", "b", "c"):
            _item(f)
        qs = lambda: svc.annotate_items(VerificationItem.objects.all()).prefetch_related("observations")
        self.assertEqual(svc.export_template_csv(qs()), svc.export_template_csv(qs()))
        forms = [r[3] for r in list(csv.reader(io.StringIO(svc.export_template_csv(qs())[1:])))[1:]]
        self.assertEqual(forms, ["c", "b", "a"])

    def test_exported_template_round_trips_as_all_blank_and_imports_nothing(self):
        _item("=evil")
        template = svc.export_template_csv(svc.annotate_items(VerificationItem.objects.all()).prefetch_related("observations"))
        report = svc.parse_import(template)
        self.assertEqual((report.error_count, len(report.rows), report.rows_skipped_blank), (0, 0, 1))


# ---------------------------------------------------------------------------
# CSV 匯入：解析（階段一）
# ---------------------------------------------------------------------------

def _csv(item_key, verdict="agree", reviewer="王老師", **extra):
    header = ["item_key", "verdict", "reviewer"] + list(extra)
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\r\n")
    w.writerow(header)
    w.writerow([item_key, verdict, reviewer] + list(extra.values()))
    return out.getvalue()


class ParseImportTests(TestCase):
    def setUp(self):
        self.item = _item("baqi")

    def test_valid_row_and_bom_and_case_insensitive_headers(self):
        text = "﻿" + "ITEM_KEY, Verdict ,Reviewer,correction,extra_col\r\n" + f"{self.item.key},AGREE,王老師,baqiy,ignored\r\n"
        report = svc.parse_import(text)
        self.assertEqual((report.error_count, len(report.rows)), (0, 1))
        row = report.rows[0]
        self.assertEqual((row.verdict, row.label, row.fields["correction"]), ("agree", "王老師", "baqiy"))

    def test_only_one_leading_bom_is_tolerated(self):
        report = svc.parse_import("﻿﻿" + _csv(self.item.key))
        self.assertGreater(report.error_count, 0)

    def test_all_errors_are_collected_not_just_the_first(self):
        text = ("item_key,verdict,reviewer\r\n"
                f"{self.item.key},maybe,A\r\n"
                f"{'0' * 64},agree,B\r\n"
                f"nothex,agree,C\r\n"
                f"{self.item.key},agree,\r\n")
        report = svc.parse_import(text)
        self.assertEqual(report.error_count, 4)
        self.assertEqual([e["line"] for e in report.errors], [2, 3, 4, 5])
        self.assertEqual(report.rows, [])

    def test_reported_errors_are_capped_but_the_total_is_exact(self):
        lines = "".join(f"nothex{i},agree,A\r\n" for i in range(svc.MAX_ERRORS_REPORTED + 30))
        report = svc.parse_import("item_key,verdict,reviewer\r\n" + lines)
        self.assertEqual(report.error_count, svc.MAX_ERRORS_REPORTED + 30)
        self.assertEqual(len(report.errors), svc.MAX_ERRORS_REPORTED)

    def test_blank_template_rows_are_skipped_but_half_filled_rows_are_errors(self):
        text = ("item_key,verdict,reviewer,correction\r\n"
                f"{self.item.key},,,\r\n"
                f"{self.item.key},,王老師,\r\n")
        report = svc.parse_import(text)
        self.assertEqual(report.rows_skipped_blank, 1)
        self.assertEqual(report.error_count, 1)
        self.assertEqual(report.errors[0]["line"], 3)

    def test_structural_problems(self):
        self.assertGreater(svc.parse_import("").error_count, 0)
        self.assertGreater(svc.parse_import("item_key,verdict\r\n").error_count, 0)                 # 缺 reviewer
        self.assertGreater(svc.parse_import("item_key,verdict,reviewer,verdict\r\n").error_count, 0)  # 重複欄名
        self.assertGreater(svc.parse_import(None).error_count, 0)
        self.assertGreater(svc.parse_import(_csv(self.item.key) + "\x00").error_count, 0)

    def test_size_and_row_limits(self):
        self.assertGreater(svc.parse_import("x" * (svc.IMPORT_MAX_BYTES + 1)).error_count, 0)
        # 結構完全合法、只是太大（全是會被略過的空白列）：必須因為大小被擋，而不是剛好因為別的原因失敗
        big = "item_key,verdict,reviewer\r\n" + ",,\r\n" * 400_000
        self.assertGreater(len(big.encode()), svc.IMPORT_MAX_BYTES)
        report = svc.parse_import(big)
        self.assertEqual((report.error_count, report.errors[0]["line"]), (1, 0))
        self.assertIn("KB", report.errors[0]["message"])
        self.assertEqual(svc.parse_import("item_key,verdict,reviewer\r\n" + ",,\r\n" * 1000).error_count, 0)
        many = "item_key,verdict,reviewer\r\n" + ("a,b,c\r\n" * (svc.IMPORT_MAX_ROWS + 1))
        report = svc.parse_import(many)
        self.assertTrue(any("列" in e["message"] for e in report.errors))

    def test_field_limits_and_control_characters(self):
        for extra in ({"correction": "x" * 201}, {"dialect": "x" * 41}, {"notes": "x" * 1001}, {"correction": "a\nb"}, {"dialect": "a\tb"}):
            self.assertEqual(svc.parse_import(_csv(self.item.key, **extra)).error_count, 1, extra)
        self.assertEqual(svc.parse_import(_csv(self.item.key, reviewer="x" * 65)).error_count, 1)
        self.assertEqual(svc.parse_import(_csv(self.item.key, notes="多行\n備註可以有換行")).error_count, 0)

    def test_windows_multiline_cells_are_accepted_and_stored_with_lf(self):
        text = '\ufeffitem_key,verdict,reviewer,notes\r\n' + f'{self.item.key},agree,A,"第一行\r\n第二行"\r\n'
        report = svc.parse_import(text)
        self.assertEqual(report.error_count, 0)
        self.assertEqual(report.rows[0].fields["notes"], "第一行\n第二行")
        self.assertEqual(svc.clean_text("a\rb", 10, field="x", multiline=True), "a\nb")
        self.assertGreater(svc.parse_import(_csv(self.item.key, notes="a\rb")).error_count + svc.parse_import(_csv(self.item.key, correction="a\rb")).error_count, 0)

    def test_legitimate_orthography_characters_are_not_treated_as_control_characters(self):
        for text in ("a\u0301", "nya\u02bc", "tay\u0331al", "\u2019", "ng\u0332"):
            self.assertEqual(svc.clean_text(text, 20, field="x"), text)
            self.assertEqual(svc.parse_import(_csv(self.item.key, correction=text)).error_count, 0, text)
        for bad in ("a\u2028b", "a\x85b", "a\x1bb"):
            with self.assertRaises(svc.ValidationFailed):
                svc.clean_text(bad, 20, field="x")

    def test_rows_with_more_cells_than_the_header_are_errors_but_empty_trailing_cells_are_fine(self):
        text = "item_key,verdict,reviewer\r\n" + f"{self.item.key},agree,A,unexpected\r\n" + f"{self.item.key},agree,B,,\r\n"
        report = svc.parse_import(text)
        self.assertEqual(report.error_count, 1)
        self.assertIn("欄位比表頭多", report.errors[0]["message"])
        self.assertEqual(len(report.rows), 1)

    def test_an_overlong_single_field_is_a_reported_error_not_an_exception(self):
        text = "item_key,verdict,reviewer,notes\r\n" + f"{self.item.key},agree,A," + "x" * 200_000 + "\r\n"
        report = svc.parse_import(text)
        self.assertGreater(report.error_count, 0)

    def test_error_line_numbers_follow_the_physical_file_for_multiline_cells(self):
        text = ("item_key,verdict,reviewer,notes\r\n" f'{self.item.key},agree,A,"a\r\nb\r\nc"\r\n' f"{'0' * 64},agree,B,\r\n")
        report = svc.parse_import(text)
        self.assertEqual([e["line"] for e in report.errors], [5])      # 表頭第 1 行；多行儲存格佔第 2～4 行；錯誤的那一列在第 5 行

    def test_duplicate_reviewer_rows_are_rejected_including_label_variants(self):
        text = ("item_key,verdict,reviewer\r\n"
                f"{self.item.key},agree,Wang  Lao-shi\r\n"
                f"{self.item.key},disagree,wang lao-shi\r\n")
        report = svc.parse_import(text)
        self.assertEqual(report.error_count, 1)
        self.assertIn("第二列", report.errors[0]["message"])

    def test_same_reviewer_on_different_items_is_fine(self):
        other = _item("azu")
        text = ("item_key,verdict,reviewer\r\n" f"{self.item.key},agree,A\r\n" f"{other.key},agree,A\r\n")
        self.assertEqual(svc.parse_import(text).error_count, 0)

    def test_malformed_csv_is_a_reported_error_not_an_exception(self):
        report = svc.parse_import('item_key,verdict,reviewer\r\n"unterminated,agree,A\r\n')
        self.assertGreater(report.error_count, 0)

    def test_external_subject_is_stable_and_label_is_not_trusted_as_identity(self):
        self.assertEqual(svc.external_subject("Wang  Lao-shi"), svc.external_subject("wang lao-shi"))
        self.assertNotEqual(svc.external_subject("a b"), svc.external_subject("a-b"))
        self.assertNotEqual(svc.external_subject("a"), svc.external_subject("b"))
        self.assertEqual(len(svc.external_subject("x")), 32)


# ---------------------------------------------------------------------------
# CSV 匯入：寫入（階段二）
# ---------------------------------------------------------------------------

class _Req:
    META = {"REMOTE_ADDR": "127.0.0.1", "HTTP_USER_AGENT": "test"}


class ApplyImportTests(TestCase):
    def setUp(self):
        self.a, self.b = _item("a"), _item("b")
        self.decoded = {"uid": "importer", "role": OWNER}

    def run_import(self, text):
        report = svc.parse_import(text)
        return report, svc.apply_import(_Req(), self.decoded, report, text)

    def text(self, *rows):
        return "item_key,verdict,reviewer,correction,notes\r\n" + "".join(",".join(r) + "\r\n" for r in rows)

    def test_creates_external_reviews_attributed_to_the_importer_and_audited(self):
        report, out = self.run_import(self.text((self.a.key, "agree", "王老師", "", "SECRET NOTE"), (self.b.key, "disagree", "李老師", "bb", "")))
        self.assertEqual((out["created"], out["updated"], out["unchanged"]), (2, 0, 0))
        review = VerificationReview.objects.get(item=self.a)
        self.assertEqual((review.reviewer_type, review.reviewer_label, review.entered_by_uid), ("external", "王老師", "importer"))
        self.assertEqual(review.reviewer_subject, svc.external_subject("王老師"))
        actions = sorted(AuditLog.objects.values_list("action", flat=True))
        self.assertEqual(actions, ["import_applied", "review_created", "review_created"])
        dump = json.dumps(list(AuditLog.objects.values("before", "after")), ensure_ascii=False)
        self.assertNotIn("SECRET NOTE", dump)                       # 稽核只放雜湊，不複製備註全文

    def test_audit_never_contains_any_free_text_field_including_dialect(self):
        text = ("item_key,verdict,reviewer,correction,dialect,notes" + "\r\n"
                f"{self.a.key},agree,LABEL-XYZ,FIX-XYZ,DIALECT-XYZ,NOTE-XYZ\r\n")
        self.run_import(text)
        dump = json.dumps(list(AuditLog.objects.values("action", "target_id", "before", "after")), ensure_ascii=False)
        for secret in ("LABEL-XYZ", "FIX-XYZ", "DIALECT-XYZ", "NOTE-XYZ"):
            self.assertNotIn(secret, dump)
        after = AuditLog.objects.get(action="review_created").after
        self.assertEqual(set(after), {"verdict", "correction_sha256", "dialect_sha256", "notes_sha256"})
        self.assertTrue(all(len(after[k]) == 16 for k in after if k.endswith("_sha256")))

    def test_re_import_is_idempotent_and_changes_are_updates(self):
        text = self.text((self.a.key, "agree", "王老師", "", ""))
        self.run_import(text)
        _, again = self.run_import(text)
        self.assertEqual((again["created"], again["updated"], again["unchanged"]), (0, 0, 1))
        _, changed = self.run_import(self.text((self.a.key, "disagree", "王老師", "x", "")))
        self.assertEqual((changed["created"], changed["updated"]), (0, 1))
        self.assertEqual(VerificationReview.objects.count(), 1)
        self.assertIn("review_updated", set(AuditLog.objects.values_list("action", flat=True)))

    def test_same_label_with_different_case_updates_the_same_review(self):
        self.run_import(self.text((self.a.key, "agree", "Wang", "", "")))
        self.run_import(self.text((self.a.key, "disagree", "wang", "", "")))
        self.assertEqual(VerificationReview.objects.count(), 1)

    def test_a_staff_review_and_an_external_review_with_the_same_text_are_separate(self):
        VerificationReview.objects.create(item=self.a, reviewer_type="staff", reviewer_subject=svc.external_subject("Wang"),
                                          reviewer_label="x", entered_by_uid="u", verdict="agree")
        self.run_import(self.text((self.a.key, "agree", "Wang", "", "")))
        self.assertEqual(VerificationReview.objects.count(), 2)

    def test_a_mid_batch_failure_rolls_everything_back_including_audit_rows(self):
        real = svc.save_review
        calls = []

        def flaky(*args, **kwargs):
            calls.append(1)
            if len(calls) == 2:
                raise IntegrityError("boom")
            return real(*args, **kwargs)
        text = self.text((self.a.key, "agree", "A", "", ""), (self.b.key, "agree", "B", "", ""))
        report = svc.parse_import(text)
        with mock.patch.object(svc, "save_review", side_effect=flaky):
            with self.assertRaises(IntegrityError):
                svc.apply_import(_Req(), self.decoded, report, text)
        self.assertEqual(VerificationReview.objects.count(), 0)
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_apply_refuses_a_report_with_errors_and_writes_nothing(self):
        text = self.text((self.a.key, "agree", "A", "", ""), ("nothex", "agree", "B", "", ""))
        report = svc.parse_import(text)
        with self.assertRaises(svc.ValidationFailed):
            svc.apply_import(_Req(), self.decoded, report, text)
        self.assertEqual(VerificationReview.objects.count(), 0)

    def test_an_item_removed_between_preview_and_apply_cancels_the_whole_batch(self):
        text = self.text((self.a.key, "agree", "A", "", ""), (self.b.key, "agree", "B", "", ""))
        report = svc.parse_import(text)
        VerificationItem.objects.filter(pk=self.b.pk).delete()
        with self.assertRaises(svc.ValidationFailed):
            svc.apply_import(_Req(), self.decoded, report, text)
        self.assertEqual(VerificationReview.objects.count(), 0)

    def test_preview_counts_match_what_apply_then_does(self):
        text = self.text((self.a.key, "agree", "A", "", ""))
        self.run_import(text)
        text2 = self.text((self.a.key, "agree", "A", "", ""), (self.b.key, "agree", "A", "", ""), (self.a.key, "disagree", "C", "", ""))
        preview = svc.preview_counts(svc.parse_import(text2))
        _, out = self.run_import(text2)
        self.assertEqual(preview, {"created": out["created"], "updated": out["updated"], "unchanged": out["unchanged"]})


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

BASE = "/adminapi/verification/"


class ApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        cache_clear = __import__("django.core.cache", fromlist=["cache"]).cache
        cache_clear.clear()
        self.item = _item("baqi")

    def get(self, role, path, uid="uid-1"):
        with _as(role, uid) as h:
            return self.client.get(BASE + path, **h)

    def post(self, role, path, payload, uid="uid-1"):
        with _as(role, uid) as h:
            return _post(self.client, BASE + path, h, payload)

    # --- 旗標 ---------------------------------------------------------------
    def test_flag_off_blocks_everything_but_status_with_a_fixed_machine_code(self):
        _enable(False)
        for path in ("items/", f"items/{self.item.pk}/", "export/"):
            r = self.get(OWNER, path)
            self.assertEqual((r.status_code, r.json()["code"]), (403, "verification_queue_disabled"), path)
        for path in (f"items/{self.item.pk}/review/", "import/"):
            r = self.post(OWNER, path, {})
            self.assertEqual((r.status_code, r.json()["code"]), (403, "verification_queue_disabled"), path)
        self.assertEqual(self.get(OWNER, "status/").json(), {"enabled": False})

    def test_a_missing_flag_row_a_database_error_and_non_true_values_are_all_closed(self):
        FeatureFlag.objects.filter(key=svc.FLAG_KEY).delete()
        self.assertFalse(svc.verification_enabled())
        self.assertEqual(self.get(OWNER, "items/").status_code, 403)
        _enable(True)
        with mock.patch.object(FeatureFlag.objects, "filter", side_effect=RuntimeError("db down")):
            self.assertFalse(svc.verification_enabled())

    def test_flag_on_opens_the_endpoints(self):
        _enable(True)
        self.assertEqual(self.get(OWNER, "items/").status_code, 200)
        self.assertEqual(self.get(OWNER, "status/").json(), {"enabled": True})

    def test_unauthorized_callers_learn_nothing_about_the_flag(self):
        _enable(False)
        self.assertEqual(self.get(None, "items/").json(), {"detail": "沒有權限執行此操作"})
        self.assertEqual(self.get(None, "status/").status_code, 403)
        with override_settings(AUTH_DEV_BYPASS=False):
            self.assertIn(self.client.get(BASE + "items/").status_code, (401, 403))
            self.assertIn(self.client.post(BASE + "import/").status_code, (401, 403))
            self.assertIn(self.client.post(BASE + f"items/{self.item.pk}/review/").status_code, (401, 403))

    def test_gate_order_is_method_then_role_then_rate_limit_then_flag_then_data(self):
        _enable(False)
        with mock.patch.object(svc, "verification_enabled", side_effect=AssertionError("flag must not be read")) as flag, \
                mock.patch("adminapi.verification_views._filtered_items", side_effect=AssertionError("no data access")) as data:
            self.assertEqual(self.get(None, "items/").status_code, 403)              # 角色不符：還沒看旗標
            with _as(OWNER) as h:
                self.assertEqual(self.client.post(BASE + "items/", **h).status_code, 405)   # method 不符：還沒驗證角色
            flag.assert_not_called()
            data.assert_not_called()
        with mock.patch.object(svc, "verification_enabled", return_value=True), \
                mock.patch("adminapi.verification_views.rate_limited_response", return_value=JsonResponse({"detail": "limited"}, status=429)), \
                mock.patch("adminapi.verification_views._filtered_items", side_effect=AssertionError("no data access")) as data:
            self.assertEqual(self.get(OWNER, "items/").status_code, 429)
            data.assert_not_called()
        with mock.patch("adminapi.verification_views._filtered_items", side_effect=AssertionError("no data access")) as data:
            self.assertEqual(self.get(OWNER, "items/").status_code, 403)             # 旗標關閉：不查資料
            data.assert_not_called()

    def test_only_a_bearer_token_authenticates_a_session_cookie_does_not(self):
        _enable(True)
        self.client.cookies["sessionid"] = "abc"
        with override_settings(AUTH_DEV_BYPASS=False):
            self.assertIn(self.client.get(BASE + "items/").status_code, (401, 403))

    def test_methods(self):
        _enable(True)
        with _as(OWNER) as h:
            self.assertEqual(self.client.post(BASE + "items/", **h).status_code, 405)
            self.assertEqual(self.client.get(BASE + f"items/{self.item.pk}/review/", **h).status_code, 405)
            self.assertEqual(self.client.get(BASE + "import/", **h).status_code, 405)
            self.assertEqual(self.client.post(BASE + "export/", **h).status_code, 405)

    # --- 角色矩陣 -----------------------------------------------------------
    def test_roles_matrix(self):
        _enable(True)
        pk = self.item.pk
        review = {"verdict": "agree"}
        csv_ok = {"csv": "item_key,verdict,reviewer\r\n", "dry_run": True}
        expectations = {
            OWNER: dict(read=200, review=201, export=200, importer=200),
            ADMIN: dict(read=200, review=201, export=200, importer=200),
            REVIEWER: dict(read=200, review=201, export=200, importer=403),
            EDITOR: dict(read=200, review=403, export=403, importer=403),
            ANALYST: dict(read=200, review=403, export=200, importer=403),
            None: dict(read=403, review=403, export=403, importer=403),
        }
        for role, exp in expectations.items():
            uid = f"u-{role}"
            self.assertEqual(self.get(role, "items/", uid).status_code, exp["read"], (role, "read"))
            self.assertEqual(self.post(role, f"items/{pk}/review/", review, uid).status_code, exp["review"], (role, "review"))
            self.assertEqual(self.get(role, "export/", uid).status_code, exp["export"], (role, "export"))
            self.assertEqual(self.post(role, "import/", csv_ok, uid).status_code, exp["importer"], (role, "import"))

    def test_opinion_details_are_only_visible_to_reviewer_roles(self):
        _enable(True)
        VerificationReview.objects.create(item=self.item, reviewer_type="external", reviewer_subject="s", reviewer_label="LABEL",
                                          entered_by_uid="u", verdict="agree", notes="PRIVATE NOTE")
        for role in (OWNER, ADMIN, REVIEWER):
            body = self.get(role, f"items/{self.item.pk}/").json()
            self.assertEqual(body["reviews"][0]["notes"], "PRIVATE NOTE", role)
        for role in (EDITOR, ANALYST):
            r = self.get(role, f"items/{self.item.pk}/")
            self.assertNotIn("reviews", r.json(), role)
            self.assertNotIn("PRIVATE NOTE", r.content.decode())
            self.assertEqual(r.json()["opinion_count"], 1)
        listing = self.get(EDITOR, "items/").content.decode()
        self.assertNotIn("PRIVATE NOTE", listing)
        self.assertNotIn("LABEL", listing)

    # --- 提交意見 -----------------------------------------------------------
    def test_submit_update_and_unchanged(self):
        _enable(True)
        r = self.post(REVIEWER, f"items/{self.item.pk}/review/", {"verdict": "disagree", "correction": "baqiy", "notes": "x"})
        self.assertEqual((r.status_code, r.json()["outcome"]), (201, "created"))
        r = self.post(REVIEWER, f"items/{self.item.pk}/review/", {"verdict": "agree", "correction": "", "notes": "x"})
        self.assertEqual((r.status_code, r.json()["outcome"]), (200, "updated"))
        r = self.post(REVIEWER, f"items/{self.item.pk}/review/", {"verdict": "agree", "correction": "", "notes": "x"})
        self.assertEqual(r.json()["outcome"], "unchanged")
        self.assertEqual(VerificationReview.objects.count(), 1)
        self.assertEqual(r.json()["item"]["my_review"]["verdict"], "agree")
        self.assertEqual(AuditLog.objects.filter(target_type="verification_item").count(), 2)       # unchanged 不寫稽核

    def test_each_staff_member_only_ever_touches_their_own_review(self):
        _enable(True)
        self.post(REVIEWER, f"items/{self.item.pk}/review/", {"verdict": "agree"}, uid="alice")
        self.post(ADMIN, f"items/{self.item.pk}/review/", {"verdict": "disagree"}, uid="bob")
        self.assertEqual(VerificationReview.objects.count(), 2)
        self.post(REVIEWER, f"items/{self.item.pk}/review/", {"verdict": "uncertain"}, uid="alice")
        verdicts = dict(VerificationReview.objects.values_list("reviewer_subject", "verdict"))
        self.assertEqual(verdicts, {"alice": "uncertain", "bob": "disagree"})
        body = self.get(OWNER, "items/").json()["results"][0]
        self.assertEqual((body["opinion_count"], body["review_state"]), (2, svc.STATE_OPINIONS))
        mine = self.get(REVIEWER, "items/", uid="alice").json()["results"][0]["my_review"]
        self.assertEqual(mine["verdict"], "uncertain")
        self.assertIsNone(self.get(REVIEWER, "items/", uid="carol").json()["results"][0]["my_review"])

    def test_a_concurrent_duplicate_create_is_a_clean_400_not_a_500(self):
        _enable(True)
        with mock.patch.object(VerificationReview.objects, "create", side_effect=IntegrityError("race")):
            r = self.post(OWNER, f"items/{self.item.pk}/review/", {"verdict": "agree"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("重新整理", r.json()["detail"])
        self.assertEqual(VerificationReview.objects.count(), 0)
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_a_very_long_casefold_expanding_correction_is_accepted_not_a_500(self):
        _enable(True)
        r = self.post(OWNER, f"items/{self.item.pk}/review/", {"verdict": "disagree", "correction": "ß" * 200})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(len(VerificationReview.objects.get().correction_norm), 400)

    def test_review_body_validation(self):
        _enable(True)
        url = f"items/{self.item.pk}/review/"
        for bad in ({}, {"verdict": "verified"}, {"verdict": "agree", "correction": "x" * 201}, {"verdict": "agree", "notes": "x" * 1001},
                    {"verdict": "agree", "dialect": "a\nb"}, {"verdict": "agree", "correction": 5}):
            self.assertEqual(self.post(OWNER, url, bad).status_code, 400, bad)
        self.assertEqual(self.post(OWNER, "items/999999/review/", {"verdict": "agree"}).status_code, 404)
        with _as(OWNER) as h:
            self.assertEqual(self.client.post(BASE + url, data="[1]", content_type="application/json", **h).status_code, 400)
            self.assertEqual(self.client.post(BASE + url, data="{bad", content_type="application/json", **h).status_code, 400)
        self.assertEqual(VerificationReview.objects.count(), 0)

    # --- 清單 ---------------------------------------------------------------
    def test_list_filters_pagination_and_validation(self):
        _enable(True)
        _item("azu", tribe="tayal")
        m = _item("mm", KIND_MORPH_ANALYSIS, proposal=PROPOSAL)
        _review(self.item, "a", "agree")
        body = self.get(OWNER, "items/").json()
        self.assertEqual(body["count"], 3)
        self.assertEqual([i["form"] for i in body["results"]], ["mm", "azu", "baqi"])
        self.assertEqual(self.get(OWNER, "items/?tribe=tayal").json()["count"], 1)
        self.assertEqual(self.get(OWNER, "items/?kind=morph_analysis").json()["results"][0]["proposal"], {**PROPOSAL, "gold_roots": ["alaw", "filo"]})
        self.assertEqual(self.get(OWNER, "items/?state=opinions_recorded").json()["count"], 1)
        self.assertEqual(self.get(OWNER, "items/?state=awaiting_expert_review").json()["count"], 2)
        self.assertEqual(self.get(OWNER, "items/?q=BAQ").json()["count"], 1)
        paged = self.get(OWNER, "items/?page=2&page_size=2").json()
        self.assertEqual((paged["count"], len(paged["results"]), paged["page"]), (3, 1, 2))
        self.assertEqual(self.get(OWNER, "items/?page_size=9999").json()["page_size"], 50)
        for bad in ("tribe=klingon", "kind=x", "state=verified", "q=" + "x" * 51, "page=abc"):
            self.assertEqual(self.get(OWNER, f"items/?{bad}").status_code, 400, bad)
        self.assertEqual(m.kind, KIND_MORPH_ANALYSIS)

    def test_list_reports_stats_and_the_standing_notice(self):
        _enable(True)
        body = self.get(OWNER, "items/").json()
        item = body["results"][0]
        self.assertEqual((item["occurrence_count"], item["sentence_count"], item["observation_count"]), (12, 8, 1))
        self.assertIn("不會寫回辭典", body["notice"])
        self.assertIn("待專家驗證", body["notice"])

    def test_responses_are_not_cacheable(self):
        _enable(True)
        for path in ("items/", "status/", f"items/{self.item.pk}/"):
            self.assertIn("no-store", self.get(OWNER, path)["Cache-Control"], path)

    # --- 匯出 ---------------------------------------------------------------
    def test_export_headers_and_filename_do_not_leak_data(self):
        _enable(True)
        r = self.get(ANALYST, "export/?tribe=kavalan")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Content-Type"], "text/csv; charset=utf-8")
        self.assertEqual(r["Content-Disposition"], 'attachment; filename="verification-queue-template.csv"')
        self.assertEqual(r["X-Content-Type-Options"], "nosniff")
        self.assertIn("no-store", r["Cache-Control"])
        self.assertTrue(r.content.startswith("﻿".encode("utf-8")))
        self.assertEqual(self.get(ANALYST, "export/?tribe=klingon").status_code, 400)

    # --- 匯入 ---------------------------------------------------------------
    def csv(self, *rows):
        return "item_key,verdict,reviewer\r\n" + "".join(",".join(r) + "\r\n" for r in rows)

    def test_import_defaults_to_a_dry_run_that_writes_nothing(self):
        _enable(True)
        r = self.post(ADMIN, "import/", {"csv": self.csv((self.item.key, "agree", "王老師"))})
        body = r.json()
        self.assertEqual((r.status_code, body["dry_run"], body["applied"], body["created"]), (200, True, False, 1))
        self.assertEqual(VerificationReview.objects.count(), 0)
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_import_applies_only_when_dry_run_is_explicitly_false(self):
        _enable(True)
        r = self.post(ADMIN, "import/", {"csv": self.csv((self.item.key, "agree", "王老師")), "dry_run": False}, uid="admin-7")
        self.assertEqual((r.status_code, r.json()["applied"], r.json()["created"]), (200, True, 1))
        review = VerificationReview.objects.get()
        self.assertEqual((review.reviewer_type, review.entered_by_uid), ("external", "admin-7"))
        self.assertTrue(AuditLog.objects.filter(action="import_applied", actor_uid="admin-7").exists())

    def test_import_errors_are_400_with_counts_and_nothing_is_written_even_when_applying(self):
        _enable(True)
        bad = self.csv((self.item.key, "agree", "A"), ("nothex", "agree", "B"))
        for dry in (True, False):
            r = self.post(OWNER, "import/", {"csv": bad, "dry_run": dry})
            self.assertEqual(r.status_code, 400)
            self.assertEqual((r.json()["error_count"], r.json()["applied"]), (1, False))
        self.assertEqual(VerificationReview.objects.count(), 0)

    def test_import_request_validation(self):
        _enable(True)
        for payload in ({"csv": "x", "dry_run": "false"}, {"csv": "x", "dry_run": 0}, [1]):
            self.assertEqual(self.post(OWNER, "import/", payload).status_code, 400, payload)
        self.assertEqual(self.post(OWNER, "import/", {"csv": 5}).status_code, 400)
        self.assertEqual(self.post(OWNER, "import/", {}).status_code, 400)
        with _as(OWNER) as h:
            r = self.client.post(BASE + "import/", data="{}", content_type="application/json", CONTENT_LENGTH=str(svc.IMPORT_MAX_BYTES * 3), **h)
            self.assertEqual(r.status_code, 413)

    def test_a_conflict_during_apply_is_a_409_and_changes_nothing(self):
        _enable(True)
        with mock.patch.object(svc, "save_review", side_effect=IntegrityError("race")):
            r = self.post(OWNER, "import/", {"csv": self.csv((self.item.key, "agree", "A")), "dry_run": False})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(VerificationReview.objects.count(), 0)

    def test_the_importer_cannot_impersonate_a_staff_account_through_the_label(self):
        _enable(True)
        self.post(REVIEWER, f"items/{self.item.pk}/review/", {"verdict": "agree"}, uid="alice")
        self.post(OWNER, "import/", {"csv": self.csv((self.item.key, "disagree", "alice")), "dry_run": False})
        self.assertEqual(VerificationReview.objects.count(), 2)                                      # 沒有覆寫 alice 的意見
        self.assertEqual(VerificationReview.objects.get(reviewer_subject="alice").verdict, "agree")

    # --- 措辭 ---------------------------------------------------------------
    def test_no_response_claims_anything_is_verified(self):
        _enable(True)
        item = self.item
        VerificationReview.objects.create(item=item, reviewer_type="staff", reviewer_subject="s", reviewer_label="l", entered_by_uid="u", verdict="agree")
        bodies = [self.get(OWNER, p).content.decode("utf-8") for p in ("items/", f"items/{item.pk}/", "export/", "status/")]
        bodies.append(self.post(OWNER, f"items/{item.pk}/review/", {"verdict": "disagree"}).content.decode("utf-8"))
        bodies.append(self.post(OWNER, "import/", {"csv": self.csv((item.key, "agree", "A")), "dry_run": False}).content.decode("utf-8"))
        bodies.append(json.dumps(list(AuditLog.objects.values_list("action", flat=True))))
        for body in bodies:
            self.assertNotIn("已驗證", body)
            self.assertNotRegex(body.lower(), r"verified|validated|\bapproved\b|\bconfirmed\b")


# ---------------------------------------------------------------------------
# 限流與種子
# ---------------------------------------------------------------------------

class RateLimitSeedTests(TestCase):
    def test_every_rate_limit_group_used_by_the_views_is_seeded_with_the_same_rate(self):
        from adminapi.management.commands.seed_rate_limit_rules import DJANGO_RULES
        seeded = {g: rate for g, rate, _ in DJANGO_RULES}
        source = (ROOT / "verification_views.py").read_text(encoding="utf-8")
        used = set(re.findall(r'_gate\(request, "[A-Z]+", [A-Z_]+, "(verification_[a-z_]+)"', source))
        self.assertEqual(used, {"verification_read", "verification_review", "verification_export", "verification_import"})
        for group in used:
            self.assertIn(group, seeded)
        self.assertEqual(seeded["verification_export"], "10/m")
        self.assertEqual(seeded["verification_import"], "10/m")


# ---------------------------------------------------------------------------
# enqueue 指令
# ---------------------------------------------------------------------------

def _coverage_report(forms=None):
    forms = forms if forms is not None else [("na", 50, 40), ("baqi", 30, 25), ("azu", 30, 20)]
    top = [{"form": f, "count": c, "sentences": s, "share": 0.1} for f, c, s in forms]
    return {"measurement_version": 3, "tribes": [{
        "tribe": "kavalan",
        "production_multiword_unmatched": {"top": [{"form": "STORED-ONLY", "count": 999, "sentences": 9, "share": 0.5}]},
        "counterfactuals": {"edge_whitespace_trimmed": {"production_multiword_unmatched": {"top": top}}},
    }]}


def _benchmark_report():
    return {"benchmark_version": 1, "max_items": 20, "tribes": [
        {"tribe": "amis", "status": "evaluated", "result": {"failure_analysis": {"wrong_root_items": [
            {"derived": "maala", "gold_roots": ["mala", "ala"], "predicted_root": "ala", "rule": "ma-"}]}}},
        {"tribe": "tayal", "status": "no_admitted_rules", "result": None},
    ]}


class EnqueueCommandTests(TestCase):
    def run_cmd(self, report, *args, flag="--from-coverage"):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "r.json"
            path.write_text(json.dumps(report), encoding="utf-8")
            out, err = io.StringIO(), io.StringIO()
            call_command("enqueue_verification_items", flag, str(path), *args, stdout=out, stderr=err)
            return out.getvalue(), err.getvalue()

    def test_dry_run_is_the_default_and_writes_nothing(self):
        out, _ = self.run_cmd(_coverage_report())
        self.assertEqual((VerificationItem.objects.count(), VerificationObservation.objects.count()), (0, 0))
        self.assertIn("預覽", out)
        self.assertIn("--apply", out)
        self.assertIn("會新建 3", out)

    def test_apply_uses_the_edge_trimmed_list_not_the_stored_one(self):
        self.run_cmd(_coverage_report(), "--apply")
        forms = set(VerificationItem.objects.values_list("form", flat=True))
        self.assertEqual(forms, {"na", "baqi", "azu"})
        self.assertNotIn("STORED-ONLY", forms)
        item = VerificationItem.objects.get(form="na")
        self.assertEqual((item.kind, item.tribe, item.created_by_uid, item.proposal), ("unmatched_form", "kavalan", enq.SYSTEM_ACTOR, None))
        obs = item.observations.get()
        self.assertEqual((obs.source, obs.report_version, obs.occurrence_count, obs.sentence_count, obs.list_size), ("coverage", 3, 50, 40, 3))
        self.assertEqual(item.observations.count(), 1)

    def test_apply_is_idempotent_and_a_new_report_adds_an_observation(self):
        self.run_cmd(_coverage_report(), "--apply")
        out, _ = self.run_cmd(_coverage_report(), "--apply")
        self.assertIn("已存在 3", out)
        self.assertEqual((VerificationItem.objects.count(), VerificationObservation.objects.count()), (3, 3))
        self.run_cmd(_coverage_report([("na", 77, 60)]), "--apply")
        self.assertEqual(VerificationItem.objects.count(), 3)
        self.assertEqual(VerificationItem.objects.get(form="na").observations.count(), 2)

    def test_dry_run_reports_existing_items_correctly(self):
        self.run_cmd(_coverage_report(), "--apply")
        out, _ = self.run_cmd(_coverage_report())
        self.assertIn("已存在 3", out)

    def test_max_truncates_after_a_fixed_ordering(self):
        self.run_cmd(_coverage_report(), "--apply", "--max", "2")
        self.assertEqual(set(VerificationItem.objects.values_list("form", flat=True)), {"na", "azu"})   # 詞次 50；30 並列時依詞形 azu 在前

    def test_tribe_filter_and_validation(self):
        self.run_cmd(_coverage_report(), "--apply", "--tribe", "tayal")
        self.assertEqual(VerificationItem.objects.count(), 0)
        for args in (["--tribe", "klingon"], ["--max", "0"], ["--max", "1001"]):
            with self.assertRaises(CommandError):
                self.run_cmd(_coverage_report(), *args)

    def test_benchmark_wrong_root_cases_become_morph_analysis_items_with_a_policy_warning(self):
        out, _ = self.run_cmd(_benchmark_report(), "--apply", flag="--from-benchmark")
        self.assertIn("final-v1", out)
        item = VerificationItem.objects.get()
        self.assertEqual((item.kind, item.tribe, item.form), (KIND_MORPH_ANALYSIS, "amis", "maala"))
        self.assertEqual(item.proposal, {"predicted_root": "ala", "rule": "ma-", "gold_roots": ["ala", "mala"]})
        obs = item.observations.get()
        self.assertEqual((obs.source, obs.list_size), ("benchmark", 1))

    def test_unrecognised_or_malformed_reports_are_rejected_without_writing(self):
        for report in ({}, {"measurement_version": 2, "tribes": []}, {"measurement_version": 3, "tribes": [{"tribe": "kavalan"}]}, [1]):
            with self.assertRaises(CommandError):
                self.run_cmd(report, "--apply")
        for report in ({"benchmark_version": 2, "tribes": []}, {"benchmark_version": 1, "tribes": [{"x": 1}]}):
            with self.assertRaises(CommandError):
                self.run_cmd(report, "--apply", flag="--from-benchmark")
        self.assertEqual(VerificationItem.objects.count(), 0)

    def test_missing_or_corrupt_source_files(self):
        with self.assertRaises(CommandError):
            call_command("enqueue_verification_items", "--from-coverage", "/no/such/file.json")
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "bad.json"
            p.write_bytes(b"\xff\xfe not json")
            with self.assertRaises(CommandError):
                call_command("enqueue_verification_items", "--from-coverage", str(p))

    def test_one_invalid_candidate_rejects_the_whole_batch_and_writes_nothing(self):
        for apply in (True, False):
            args = ("--apply",) if apply else ()
            with self.assertRaises(CommandError) as ctx:
                self.run_cmd(_coverage_report([("ok", 5, 5), ("bad\nform", 4, 4)]), *args)
            self.assertIn("整批都沒有寫入", str(ctx.exception))
            self.assertIn("1 筆不合法", str(ctx.exception))
        self.assertEqual((VerificationItem.objects.count(), VerificationObservation.objects.count()), (0, 0))

    def test_dry_run_and_apply_agree_on_what_is_invalid(self):
        report = _coverage_report([("ok", 5, 5)])
        report["tribes"][0]["tribe"] = "klingon"                       # 來源報告含未知族語
        for args in ((), ("--apply",)):
            with self.assertRaises(CommandError):
                self.run_cmd(report, *args)
        report = _coverage_report([("ok", 5, 9)])                       # 句數大於詞次：不合法的統計
        for args in ((), ("--apply",)):
            with self.assertRaises(CommandError):
                self.run_cmd(report, *args)
        self.assertEqual(VerificationItem.objects.count(), 0)

    def test_a_database_failure_midway_rolls_the_whole_batch_back(self):
        real = svc._write_candidate
        calls = []

        def flaky(candidate, created_by):
            calls.append(1)
            if len(calls) == 3:
                raise IntegrityError("boom")
            return real(candidate, created_by)
        with mock.patch.object(svc, "_write_candidate", side_effect=flaky):
            with self.assertRaises(IntegrityError):
                self.run_cmd(_coverage_report(), "--apply")
        self.assertEqual((VerificationItem.objects.count(), VerificationObservation.objects.count()), (0, 0))

    def test_malformed_report_fields_are_command_errors_not_tracebacks(self):
        bad_entries = [{"form": "x", "count": "many", "sentences": 1}, {"form": "x", "count": 1}, {"count": 1, "sentences": 1}, "x", None]
        for entry in bad_entries:
            report = _coverage_report([])
            report["tribes"][0]["counterfactuals"]["edge_whitespace_trimmed"]["production_multiword_unmatched"]["top"] = [entry]
            with self.assertRaises(CommandError):
                self.run_cmd(report, "--apply")
        self.assertEqual(VerificationItem.objects.count(), 0)

    def test_a_duplicate_candidate_never_lets_a_smaller_count_overwrite_the_larger_one(self):
        report = _coverage_report([("na", 50, 40), ("na", 7, 3)])
        self.run_cmd(report, "--apply")
        obs = VerificationObservation.objects.get()
        self.assertEqual((obs.occurrence_count, obs.sentence_count), (50, 40))
        # 反過來排也一樣：排序先把較大的放前面
        VerificationItem.objects.all().delete()
        self.run_cmd(_coverage_report([("na", 7, 3), ("na", 50, 40)]), "--apply")
        self.assertEqual(VerificationObservation.objects.get().occurrence_count, 50)

    def test_every_candidate_is_validated_before_the_max_truncation(self):
        # 不合法的候選詞次最小、排在 --max 之外：仍然要讓整批失敗，而不是被截掉後悄悄成功
        report = _coverage_report([("na", 50, 40), ("baqi", 30, 25), ("zzz", 1, 1)])
        report["tribes"][0]["counterfactuals"]["edge_whitespace_trimmed"]["production_multiword_unmatched"]["top"][2]["sentences"] = 99
        with self.assertRaises(CommandError):
            self.run_cmd(report, "--apply", "--max", "2")
        self.assertEqual(VerificationItem.objects.count(), 0)

    def test_non_integer_counts_are_rejected_not_sorted_as_zero(self):
        for bad in ("100", 100.0, True, None, 10 ** 12):
            report = _coverage_report([("na", 5, 5), ("baqi", 4, 4)])
            report["tribes"][0]["counterfactuals"]["edge_whitespace_trimmed"]["production_multiword_unmatched"]["top"][1]["count"] = bad
            with self.assertRaises(CommandError, msg=repr(bad)):
                self.run_cmd(report, "--apply", "--max", "1")
        self.assertEqual(VerificationItem.objects.count(), 0)

    def test_the_same_candidate_listed_twice_is_counted_once_in_both_preview_and_apply(self):
        report = _coverage_report([("na", 50, 40), ("na", 50, 40), ("baqi", 3, 2)])
        preview, _ = self.run_cmd(report)
        applied, _ = self.run_cmd(report, "--apply")
        self.assertIn("處理 3 筆", preview)
        self.assertIn("會新建 2、已存在 0", preview)
        self.assertIn("新建 2、已存在 0", applied)
        self.assertEqual(VerificationItem.objects.count(), 2)

    def test_dry_run_counts_match_what_apply_then_reports(self):
        self.run_cmd(_coverage_report([("na", 50, 40)]), "--apply")
        report = _coverage_report([("na", 50, 40), ("baqi", 30, 25), ("azu", 30, 20)])
        preview, _ = self.run_cmd(report)
        applied, _ = self.run_cmd(report, "--apply")
        self.assertIn("會新建 2、已存在 1", preview)
        self.assertIn("新建 2、已存在 1", applied)

    def test_stored_data_contains_no_sentence_text(self):
        report = _coverage_report([("na", 5, 5)])
        report["tribes"][0]["counterfactuals"]["edge_whitespace_trimmed"]["production_multiword_unmatched"]["top"][0]["example"] = "FULL SENTENCE TEXT"
        self.run_cmd(report, "--apply")
        dump = json.dumps(list(VerificationItem.objects.values()) + list(VerificationObservation.objects.values()), default=str)
        self.assertNotIn("FULL SENTENCE TEXT", dump)


# ---------------------------------------------------------------------------
# 邊界：絕不寫回辭典、干擾項
# ---------------------------------------------------------------------------

FORBIDDEN_IMPORT_ROOTS = ("dictionary_db", "dictionary_write", "dictionary_import", "dictionary_views", "dictionary_revision_service",
                          "dictionary_cache", "dictionary_serializers", "fastAPI", "crawler", "AIModel", "quizbank_service")
VERIFICATION_FILES = ("verification_service.py", "verification_views.py", "models/verification.py",
                      "management/commands/enqueue_verification_items.py")


def _imports(path):
    tree = ast.parse((ROOT / path).read_text(encoding="utf-8"))
    names = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            base = ("." * node.level) + (node.module or "")
            names.append(base)
            names += [f"{base}.{a.name}" for a in node.names]
    return names


class BoundaryTests(TestCase):
    def test_verification_code_never_imports_dictionary_distractor_or_quiz_modules(self):
        for path in VERIFICATION_FILES:
            for name in _imports(path):
                parts = re.split(r"[./]+", name.lstrip("."))
                self.assertFalse(set(parts) & set(FORBIDDEN_IMPORT_ROOTS), (path, name))

    def test_the_boundary_scan_actually_detects_a_forbidden_import(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "x.py"
            p.write_text("from dictionary_db.connect import SessionLocal\nimport fastAPI.routes.quiz\n", encoding="utf-8")
            tree = ast.parse(p.read_text(encoding="utf-8"))
            found = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)} | {a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
        self.assertTrue(any(f.split(".")[0] in FORBIDDEN_IMPORT_ROOTS for f in found))

    def test_no_apply_correction_action_exists(self):
        for path in VERIFICATION_FILES:
            source = (ROOT / path).read_text(encoding="utf-8").lower()
            for word in ("apply_correction", "publish_correction", "write_back", "writeback"):
                self.assertNotIn(word, source, (path, word))
        urls = (ROOT / "urls.py").read_text(encoding="utf-8")
        verification_routes = re.findall(r"path\('(verification/[^']*)'", urls)
        self.assertEqual(sorted(verification_routes), sorted([
            "verification/status/", "verification/items/", "verification/items/<int:pk>/", "verification/items/<int:pk>/review/",
            "verification/export/", "verification/import/"]))

    def test_every_flow_runs_with_the_dictionary_connections_booby_trapped_and_quiz_tables_unchanged(self):
        _enable(True)
        quiz_before = QuizChoiceItem.objects.count()
        flags_before = FeatureFlag.objects.count()

        def trap(*a, **k):
            raise AssertionError("驗證佇列不得碰辭典資料庫")
        with mock.patch("dictionary_db.connect.SessionLocal", side_effect=trap), \
                mock.patch("dictionary_db.connect.dictionary_write_session", side_effect=trap):
            report = {"measurement_version": 3, "tribes": [{"tribe": "kavalan", "counterfactuals": {"edge_whitespace_trimmed": {
                "production_multiword_unmatched": {"top": [{"form": "baqi", "count": 3, "sentences": 2}]}}}}]}
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "r.json"
                path.write_text(json.dumps(report), encoding="utf-8")
                call_command("enqueue_verification_items", "--from-coverage", str(path), "--apply", stdout=io.StringIO())
            item = VerificationItem.objects.get()
            client = Client()
            with _as(OWNER, "o1") as h:
                self.assertEqual(client.get(BASE + "items/", **h).status_code, 200)
                self.assertEqual(client.get(BASE + f"items/{item.pk}/", **h).status_code, 200)
                self.assertEqual(_post(client, BASE + f"items/{item.pk}/review/", h, {"verdict": "disagree", "correction": "baqiy"}).status_code, 201)
                self.assertEqual(client.get(BASE + "export/", **h).status_code, 200)
                csv_text = f"item_key,verdict,reviewer,correction\r\n{item.key},agree,X,baqiy\r\n"
                self.assertEqual(_post(client, BASE + "import/", h, {"csv": csv_text, "dry_run": False}).status_code, 200)
        self.assertEqual((QuizChoiceItem.objects.count(), FeatureFlag.objects.count()), (quiz_before, flags_before))
        self.assertEqual(VerificationReview.objects.count(), 2)

    def test_deleting_everything_in_the_queue_leaves_other_tables_untouched(self):
        item = _item()
        _review(item, "a", "agree")
        before = (FeatureFlag.objects.count(), AuditLog.objects.count())
        VerificationItem.objects.all().delete()
        self.assertEqual((VerificationReview.objects.count(), VerificationObservation.objects.count()), (0, 0))
        self.assertEqual((FeatureFlag.objects.count(), AuditLog.objects.count()), before)

    def test_db_constraints_reject_bad_values_even_if_the_service_is_bypassed(self):
        item = _item()
        for kwargs in ({"verdict": "verified"}, {"reviewer_type": "robot"}, {"reviewer_subject": ""}):
            data = dict(item=item, reviewer_type="staff", reviewer_subject="s", reviewer_label="l", entered_by_uid="u", verdict="agree")
            data.update(kwargs)
            with self.assertRaises(IntegrityError):
                from django.db import transaction
                with transaction.atomic():
                    VerificationReview.objects.create(**data)
        with self.assertRaises(IntegrityError):
            from django.db import transaction
            with transaction.atomic():
                VerificationItem.objects.create(key="k" * 64, tribe="kavalan", kind="weird", form="x", created_by_uid="u")
        _review(item, "dup", "agree")
        with self.assertRaises(IntegrityError):
            from django.db import transaction
            with transaction.atomic():
                _review(item, "dup", "disagree")
