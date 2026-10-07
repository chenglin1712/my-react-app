"""待專家驗證佇列（M5）的業務邏輯：規範化與 key、狀態推導、意見提交、CSV 匯出與匯入、旗標判斷。

【邊界：意見永遠不寫回辭典或干擾項】這個模組與 verification_views.py、enqueue_verification_items 指令只會寫三張表：
VerificationItem／VerificationObservation／VerificationReview，外加同一個 transaction 裡的 AuditLog。它們不得 import
dictionary_db、dictionary_write、測驗干擾項（fastAPI.routes.quiz）或任何辭典服務；也沒有任何「套用建議」的動作——
correction 只是審核者的意見文字。這條邊界有機械式測試鎖住（test_verification_boundary）：掃描 import、patch 辭典連線讓它一碰就失敗。

【措辭】項目永遠是「待專家驗證」的候選；意見是 agree／disagree／uncertain，不是驗證結果。狀態只描述資料狀況
（awaiting_expert_review／opinions_recorded／conflicting_opinions），沒有任何「已驗證」的狀態或欄位。
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import unicodedata
from dataclasses import dataclass, field

from django.db import IntegrityError, transaction
from django.db.models import Count, Q

from config.tribes import TRIBES

from ._shared import write_audit_log
from .models import FeatureFlag, VerificationItem, VerificationObservation, VerificationReview
from .models.verification import (
    KIND_MORPH_ANALYSIS, KIND_UNMATCHED_FORM, KINDS, OBSERVATION_SOURCES, REVIEWER_EXTERNAL, REVIEWER_STAFF, VERDICTS,
)

FLAG_KEY = "verification_queue"
TRIBE_SLUGS = frozenset(t.slug for t in TRIBES)

MAX_FORM = 200
MAX_LABEL = 64
MAX_CORRECTION = 200
MAX_DIALECT = 40
MAX_NOTES = 1000
IMPORT_MAX_BYTES = 1_000_000
IMPORT_MAX_ROWS = 2000
MAX_ERRORS_REPORTED = 50
EXPORT_MAX_ROWS = 5000

STATE_AWAITING = "awaiting_expert_review"
STATE_OPINIONS = "opinions_recorded"
STATE_CONFLICT = "conflicting_opinions"
STATES = (STATE_AWAITING, STATE_OPINIONS, STATE_CONFLICT)

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f-\x9f  ]")   # 不含 tab、LF、CR（單行欄位另外拒絕這三個）
_HEX64_RE = re.compile(r"[0-9a-f]{64}")


class ValidationFailed(ValueError):
    """輸入不合法；訊息可以直接顯示給使用者（不含內部細節）。"""


# ---------------------------------------------------------------------------
# 旗標（fail-closed）
# ---------------------------------------------------------------------------

def verification_enabled() -> bool:
    """缺列、查詢失敗、值不是明確的 True 一律視為關閉。FeatureFlag.enabled 的 model 預設是 True，所以不能用「查不到就用預設」。"""
    try:
        value = FeatureFlag.objects.filter(key=FLAG_KEY).values_list("enabled", flat=True).first()
    except Exception:
        return False
    return value is True


# ---------------------------------------------------------------------------
# 驗證與規範化
# ---------------------------------------------------------------------------

def clean_text(value, limit: int, *, field: str, multiline: bool = False, required: bool = False) -> str:
    """去頭尾空白；單行欄位不允許換行與 Tab；一律拒絕其他控制字元與超長；不做大小寫或 Unicode 正規化。"""
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ValidationFailed(f"{field} 必須是文字")
    text = value.strip()
    if multiline:
        text = text.replace("\r\n", "\n").replace("\r", "\n")     # Excel／Windows 的多行儲存格是 CRLF；統一成 LF，「沒變動」的判斷才穩定
    if _CONTROL_RE.search(text) or (not multiline and re.search(r"[\t\r\n]", text)):
        raise ValidationFailed(f"{field} 含有不允許的控制字元")
    if len(text) > limit:
        raise ValidationFailed(f"{field} 超過 {limit} 字")
    if required and not text:
        raise ValidationFailed(f"{field} 不可為空")
    return text


def validate_proposal(kind: str, proposal) -> dict | None:
    """依種類驗證並轉成固定格式；unmatched_form 一律是 None；morph_analysis 是 {predicted_root, rule, gold_roots(已排序去重)}。"""
    if kind == KIND_UNMATCHED_FORM:
        if proposal not in (None, {}):
            raise ValidationFailed("unmatched_form 不應有提案內容")
        return None
    if kind == KIND_MORPH_ANALYSIS:
        if not isinstance(proposal, dict) or set(proposal) != {"predicted_root", "rule", "gold_roots"}:
            raise ValidationFailed("morph_analysis 的提案必須剛好有 predicted_root、rule、gold_roots")
        roots = proposal["gold_roots"]
        if not isinstance(roots, list) or not 1 <= len(roots) <= 10:
            raise ValidationFailed("gold_roots 必須是 1 到 10 個詞根的清單")
        return {
            "predicted_root": clean_text(proposal["predicted_root"], MAX_FORM, field="predicted_root", required=True),
            "rule": clean_text(proposal["rule"], 40, field="rule", required=True),
            "gold_roots": sorted({clean_text(r, MAX_FORM, field="gold_roots", required=True) for r in roots}),
        }
    raise ValidationFailed("未知的項目種類")


def canonical_key_payload(tribe: str, kind: str, form: str, proposal: dict | None) -> str:
    """key 的唯一規範化輸入：固定鍵序、UTF-8、無多餘空白、null 明確；欄位值本身不做任何正規化（form 只去頭尾空白）。"""
    return json.dumps({"form": form, "kind": kind, "proposal": proposal, "tribe": tribe},
                      sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def item_key(tribe: str, kind: str, form: str, proposal: dict | None) -> str:
    return hashlib.sha256(canonical_key_payload(tribe, kind, form, proposal).encode("utf-8")).hexdigest()


def correction_norm(correction: str) -> str:
    return " ".join(unicodedata.normalize("NFC", correction).casefold().split())


def external_subject(label: str) -> str:
    """外部審核者的識別：標籤正規化（NFC、casefold、空白收斂）後的雜湊。跨批次同標籤視為同一人——標籤不是身分證明，
    所以只用來避免同一人重複計票與覆寫自己的舊意見，不代表任何資格。"""
    norm = " ".join(unicodedata.normalize("NFC", label).casefold().split())
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()[:32]


# ---------------------------------------------------------------------------
# 項目建立（enqueue 用）
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ObservationInput:
    source: str
    report_version: int
    report_label: str
    occurrence_count: int
    sentence_count: int
    list_size: int


INT32_MAX = 2_147_483_647      # PositiveIntegerField 的上限（PostgreSQL integer）
INT16_MAX = 32_767             # PositiveSmallIntegerField 的上限


def _count(value, field: str, *, minimum: int = 0, maximum: int = INT32_MAX) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValidationFailed(f"{field} 必須是 {minimum} 到 {maximum} 之間的整數")
    return value


def validate_observation(obs: ObservationInput) -> ObservationInput:
    """與資料庫的 CheckConstraint 同一組規則：服務層先擋，資料庫是最後一道防線。"""
    if obs.source not in OBSERVATION_SOURCES:
        raise ValidationFailed("未知的來源報告種類")
    label = clean_text(obs.report_label, 40, field="report_label", required=True)
    occurrence = _count(obs.occurrence_count, "occurrence_count")
    sentences = _count(obs.sentence_count, "sentence_count")
    if sentences > occurrence:
        raise ValidationFailed("sentence_count 不可大於 occurrence_count")
    return ObservationInput(obs.source, _count(obs.report_version, "report_version", minimum=1, maximum=INT16_MAX), label, occurrence, sentences,
                            _count(obs.list_size, "list_size", minimum=1))


@dataclass(frozen=True)
class Candidate:
    tribe: str
    kind: str
    form: str
    proposal: dict | None
    key: str
    obs: ObservationInput


def validate_candidate(tribe, kind, form, proposal, obs: ObservationInput) -> Candidate:
    """一個候選的完整驗證（dry-run 與寫入共用同一個函式，所以兩者的判斷必然一致）。"""
    if tribe not in TRIBE_SLUGS:
        raise ValidationFailed("未知的族語")
    if kind not in KINDS:
        raise ValidationFailed("未知的項目種類")
    form = clean_text(form, MAX_FORM, field="form", required=True)
    proposal = validate_proposal(kind, proposal)
    return Candidate(tribe, kind, form, proposal, item_key(tribe, kind, form, proposal), validate_observation(obs))


def _write_candidate(c: Candidate, created_by: str) -> tuple[VerificationItem, bool]:
    item, created = VerificationItem.objects.get_or_create(
        key=c.key, defaults={"tribe": c.tribe, "kind": c.kind, "form": c.form, "proposal": c.proposal, "created_by_uid": created_by})
    VerificationObservation.objects.update_or_create(
        item=item, source=c.obs.source, report_label=c.obs.report_label,
        defaults={"report_version": c.obs.report_version, "occurrence_count": c.obs.occurrence_count,
                  "sentence_count": c.obs.sentence_count, "list_size": c.obs.list_size})
    return item, created


def upsert_item(tribe: str, kind: str, form: str, proposal, created_by: str, obs: ObservationInput) -> tuple[VerificationItem, bool]:
    """建立項目（若 key 已存在就沿用），並新增或更新這份來源報告的觀測。回傳 (項目, 是否新建)。"""
    candidate = validate_candidate(tribe, kind, form, proposal, obs)
    with transaction.atomic():
        return _write_candidate(candidate, created_by)


def preview_candidates(candidates: list[Candidate]) -> dict:
    """dry-run：與寫入同一套驗證（呼叫端已用 validate_candidate 驗過），只算「會新建幾筆、已存在幾筆」，不寫入。"""
    keys = {c.key for c in candidates}
    existing = set(VerificationItem.objects.filter(key__in=keys).values_list("key", flat=True))
    return {"would_create": len(keys - existing), "already_exist": len(keys & existing)}


def enqueue_batch(candidates: list[Candidate], created_by: str) -> dict:
    """整批寫入：單一 transaction，任何一筆失敗整批 rollback。"""
    created = existing = 0
    seen: set[tuple] = set()
    unique = []
    for c in candidates:
        marker = (c.key, c.obs.source, c.obs.report_label)
        if marker not in seen:               # 同一份報告裡重複的候選只處理第一筆（候選已依詞次由大到小排序），不會讓較小的值覆蓋較大的
            seen.add(marker)
            unique.append(c)
    with transaction.atomic():
        for c in unique:
            _, was_created = _write_candidate(c, created_by)
            created += was_created
            existing += not was_created
    return {"created": created, "already_exist": existing}


# ---------------------------------------------------------------------------
# 狀態推導
# ---------------------------------------------------------------------------

def annotate_items(queryset):
    """在資料庫端算好意見數與各 verdict 數，以及互不相同的建議數（用 correction_norm）。"""
    return queryset.annotate(
        opinion_count=Count("reviews", distinct=True),
        agree_count=Count("reviews", filter=Q(reviews__verdict="agree"), distinct=True),
        disagree_count=Count("reviews", filter=Q(reviews__verdict="disagree"), distinct=True),
        uncertain_count=Count("reviews", filter=Q(reviews__verdict="uncertain"), distinct=True),
        correction_variants=Count("reviews__correction_norm", filter=~Q(reviews__correction_norm=""), distinct=True),
    )


def has_conflicting_opinions(agree: int, disagree: int, correction_variants: int) -> bool:
    """agree 與 disagree 並存，或兩位以上提出互不相同的建議。uncertain 不構成衝突、也不構成共識。"""
    return (agree > 0 and disagree > 0) or correction_variants > 1


def review_state(opinion_count: int, agree: int, disagree: int, correction_variants: int) -> str:
    if opinion_count == 0:
        return STATE_AWAITING
    return STATE_CONFLICT if has_conflicting_opinions(agree, disagree, correction_variants) else STATE_OPINIONS


def filter_by_state(queryset, state: str):
    """queryset 必須已經 annotate_items。"""
    conflict = (Q(agree_count__gt=0) & Q(disagree_count__gt=0)) | Q(correction_variants__gt=1)
    if state == STATE_AWAITING:
        return queryset.filter(opinion_count=0)
    if state == STATE_CONFLICT:
        return queryset.filter(conflict)
    if state == STATE_OPINIONS:
        return queryset.filter(opinion_count__gt=0).exclude(conflict)
    raise ValidationFailed("未知的狀態篩選")


def latest_observation(item: VerificationItem):
    observations = list(item.observations.all())   # 呼叫端應 prefetch；ordering 為 -observed_at, -id
    return observations[0] if observations else None


# ---------------------------------------------------------------------------
# 意見提交（UI）
# ---------------------------------------------------------------------------

def _compact_review(review: VerificationReview | None) -> dict | None:
    if review is None:
        return None
    def digest(text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16] if text else ""
    # 稽核只放 verdict 與各自由文字欄位的雜湊（不複製全文，包含 dialect）
    return {"verdict": review.verdict, "correction_sha256": digest(review.correction),
            "dialect_sha256": digest(review.dialect), "notes_sha256": digest(review.notes)}


def parse_review_fields(data: dict) -> dict:
    verdict = data.get("verdict")
    if verdict not in VERDICTS:
        raise ValidationFailed("verdict 必須是 agree、disagree 或 uncertain")
    correction = clean_text(data.get("correction"), MAX_CORRECTION, field="correction")
    return {
        "verdict": verdict, "correction": correction, "correction_norm": correction_norm(correction),
        "dialect": clean_text(data.get("dialect"), MAX_DIALECT, field="dialect"),
        "notes": clean_text(data.get("notes"), MAX_NOTES, field="notes", multiline=True),
    }


def staff_label(uid: str) -> str:
    return f"staff:{uid[:6]}"


def save_review(request, decoded, item: VerificationItem, fields: dict, *, reviewer_type: str, subject: str, label: str,
                entered_by: str) -> tuple[VerificationReview, str]:
    """建立或更新「這個審核者」對這個項目的意見，與稽核紀錄同一個 transaction。回傳 (意見, "created"|"updated"|"unchanged")。"""
    with transaction.atomic():
        try:
            review = (VerificationReview.objects.select_for_update()
                      .get(item=item, reviewer_type=reviewer_type, reviewer_subject=subject))
        except VerificationReview.DoesNotExist:
            review = None
        before = _compact_review(review)
        if review is None:
            try:
                with transaction.atomic():
                    review = VerificationReview.objects.create(
                        item=item, reviewer_type=reviewer_type, reviewer_subject=subject, reviewer_label=label,
                        entered_by_uid=entered_by, **fields)
            except IntegrityError:
                raise ValidationFailed("同一位審核者同時送出了兩次意見，請重新整理後再試")
            outcome = "created"
        else:
            changed = [k for k, v in fields.items() if getattr(review, k) != v] + (
                ["reviewer_label"] if review.reviewer_label != label else [])
            if not changed:
                return review, "unchanged"
            for k, v in fields.items():
                setattr(review, k, v)
            review.reviewer_label, review.entered_by_uid = label, entered_by
            review.save()
            outcome = "updated"
        write_audit_log(request, decoded, f"review_{outcome}", f"{item.pk}", before=before, after=_compact_review(review),
                        target_type="verification_item")
    return review, outcome


# ---------------------------------------------------------------------------
# CSV 匯出（待填範本）
# ---------------------------------------------------------------------------

EXPORT_COLUMNS = [
    "item_key", "tribe", "kind", "form", "predicted_root", "rule", "gold_roots", "occurrence_count", "sentence_count",
    "review_state", "opinion_count",
    "reviewer", "verdict", "correction", "dialect", "notes",       # 以下五欄留白，給審核者填；匯入時只讀這五欄加 item_key
]


def csv_safe(value) -> str:
    """防 CSV 公式注入：任何字串（含前置空白或控制字元之後才出現）以 = + - @ Tab CR 開頭就加單引號。數字不動。"""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    text = "" if value is None else str(value)
    probe = text.lstrip(" \t\r\n\x00\x0b\x0c ")
    if probe[:1] in ("=", "+", "-", "@") or text[:1] in ("\t", "\r"):
        return "'" + text
    return text


def export_template_csv(queryset) -> str:
    """queryset 必須已經 annotate_items 並 prefetch observations。輸出 UTF-8 BOM 開頭的 CSV。
    只含項目與統計，不含任何人的意見，所以不會洩漏審核者標籤或備註；填寫用的五欄是空白的，因此匯出的字串欄位被加上單引號
    保護時，不會經由「匯出再匯入」變成真的內容（匯入只讀審核者填的那五欄，從不讀這些顯示欄）。"""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(EXPORT_COLUMNS)
    for item in queryset.order_by("-created_at", "-id")[:EXPORT_MAX_ROWS]:
        proposal = item.proposal or {}
        obs = latest_observation(item)
        writer.writerow([
            item.key, csv_safe(item.tribe), csv_safe(item.kind), csv_safe(item.form),
            csv_safe(proposal.get("predicted_root", "")), csv_safe(proposal.get("rule", "")),
            csv_safe("|".join(proposal.get("gold_roots", []))),
            obs.occurrence_count if obs else "", obs.sentence_count if obs else "",
            review_state(item.opinion_count, item.agree_count, item.disagree_count, item.correction_variants), item.opinion_count,
            "", "", "", "", "",
        ])
    return "﻿" + buf.getvalue()


# ---------------------------------------------------------------------------
# CSV 匯入（兩階段：全量驗證，再單一 transaction 寫入）
# ---------------------------------------------------------------------------

@dataclass
class ParsedRow:
    line: int
    key: str
    verdict: str
    label: str
    subject: str
    fields: dict


@dataclass
class ImportReport:
    rows_total: int = 0
    rows_skipped_blank: int = 0
    errors: list = field(default_factory=list)
    error_count: int = 0
    rows: list = field(default_factory=list)

    def add_error(self, line: int, message: str):
        self.error_count += 1
        if len(self.errors) < MAX_ERRORS_REPORTED:
            self.errors.append({"line": line, "message": message})


_REQUIRED_HEADERS = ("item_key", "verdict", "reviewer")
_INPUT_HEADERS = ("verdict", "reviewer", "correction", "dialect", "notes")


def parse_import(csv_text: str) -> ImportReport:
    """階段一：只解析與驗證，不碰資料庫寫入（只讀取項目是否存在）。回傳的 rows 是通過驗證、可以寫入的列。"""
    report = ImportReport()
    if not isinstance(csv_text, str):
        report.add_error(0, "csv 必須是文字")
        return report
    if len(csv_text.encode("utf-8")) > IMPORT_MAX_BYTES:
        report.add_error(0, f"檔案超過 {IMPORT_MAX_BYTES // 1000} KB")
        return report
    if "\x00" in csv_text:
        report.add_error(0, "檔案含有不合法的字元")
        return report
    if csv_text.startswith("﻿"):
        csv_text = csv_text[1:]          # 只容忍開頭的一個 BOM
    try:
        reader = csv.reader(io.StringIO(csv_text, newline=""), strict=True)
        header = next(reader, None)
        if header is None:
            report.add_error(1, "檔案是空的")
            return report
        names = [h.strip().lower() for h in header]
        if len(set(names)) != len(names):
            report.add_error(1, "表頭有重複的欄位名稱")
            return report
        missing = [h for h in _REQUIRED_HEADERS if h not in names]
        if missing:
            report.add_error(1, "缺少必要欄位：" + "、".join(missing))
            return report
        index = {n: i for i, n in enumerate(names)}

        def cell(row, name):
            i = index.get(name)
            return row[i] if i is not None and i < len(row) else ""

        candidates: list[tuple[int, dict]] = []
        for row in reader:
            lineno = reader.line_num          # 這一筆紀錄結束的行號（含引號內換行的多行儲存格時是它的最後一行）
            if not any(c.strip() for c in row):
                continue
            report.rows_total += 1
            if report.rows_total > IMPORT_MAX_ROWS:
                report.add_error(lineno, f"資料列超過 {IMPORT_MAX_ROWS} 列")
                return report
            if len(row) > len(header) and any(c.strip() for c in row[len(header):]):
                report.add_error(lineno, "這一列的欄位比表頭多（可能是逗號沒有用引號包起來）")
                continue
            inputs = {name: cell(row, name) for name in _INPUT_HEADERS}
            if not any(v.strip() for v in inputs.values()):
                report.rows_skipped_blank += 1          # 範本裡審核者沒填的列：略過，不算錯
                continue
            candidates.append((lineno, {"item_key": cell(row, "item_key").strip(), **inputs}))
    except csv.Error as exc:
        report.add_error(0, f"CSV 格式錯誤（{exc.__class__.__name__}）")
        return report

    keys = {c["item_key"] for _, c in candidates if _HEX64_RE.fullmatch(c["item_key"])}
    existing = set(VerificationItem.objects.filter(key__in=keys).values_list("key", flat=True)) if keys else set()
    seen: set[tuple[str, str]] = set()
    for lineno, c in candidates:
        try:
            if not _HEX64_RE.fullmatch(c["item_key"]):
                raise ValidationFailed("item_key 必須是 64 位小寫十六進位")
            if c["item_key"] not in existing:
                raise ValidationFailed("找不到這個 item_key 的項目")
            verdict = c["verdict"].strip().lower()
            if verdict not in VERDICTS:
                raise ValidationFailed("verdict 必須是 agree、disagree 或 uncertain")
            label = clean_text(c["reviewer"], MAX_LABEL, field="reviewer", required=True)
            fields = parse_review_fields({"verdict": verdict, "correction": c["correction"], "dialect": c["dialect"], "notes": c["notes"]})
            subject = external_subject(label)
            if (c["item_key"], subject) in seen:
                raise ValidationFailed("同一個審核者在同一個項目出現第二列")
            seen.add((c["item_key"], subject))
            report.rows.append(ParsedRow(lineno, c["item_key"], verdict, label, subject, fields))
        except ValidationFailed as exc:
            report.add_error(lineno, str(exc))
    return report


def import_summary(report: ImportReport, created: int | None = None, updated: int | None = None, unchanged: int | None = None) -> dict:
    out = {"rows_total": report.rows_total, "rows_skipped_blank": report.rows_skipped_blank,
           "rows_valid": len(report.rows), "error_count": report.error_count, "errors": report.errors}
    if created is not None:
        out.update({"created": created, "updated": updated, "unchanged": unchanged})
    return out


def preview_counts(report: ImportReport) -> dict:
    """dry-run 用：這批列如果現在寫入，會新增幾筆、更新幾筆、幾筆沒變（只是預覽，寫入時會重新判斷）。"""
    created = updated = unchanged = 0
    by_key = {i.key: i for i in VerificationItem.objects.filter(key__in={r.key for r in report.rows})}
    for r in report.rows:
        review = VerificationReview.objects.filter(
            item=by_key[r.key], reviewer_type=REVIEWER_EXTERNAL, reviewer_subject=r.subject).first()
        if review is None:
            created += 1
        elif any(getattr(review, k) != v for k, v in r.fields.items()) or review.reviewer_label != r.label:
            updated += 1
        else:
            unchanged += 1
    return {"created": created, "updated": updated, "unchanged": unchanged}


def apply_import(request, decoded, report: ImportReport, csv_text: str) -> dict:
    """階段二：單一 transaction 寫入。任何一列失敗整批 rollback。稽核：每筆新增／更新各一筆精簡紀錄＋一筆整批紀錄（檔案雜湊與計數）。"""
    if report.error_count:
        raise ValidationFailed("檔案有錯誤，沒有寫入任何資料")
    actor = decoded.get("uid", "anon")
    created = updated = unchanged = 0
    with transaction.atomic():
        items = {i.key: i for i in VerificationItem.objects.select_for_update().filter(key__in={r.key for r in report.rows})}
        for r in report.rows:
            item = items.get(r.key)
            if item is None:
                raise ValidationFailed("寫入前項目已被移除，整批已取消，請重新匯入")
            _, outcome = save_review(request, decoded, item, r.fields, reviewer_type=REVIEWER_EXTERNAL,
                                     subject=r.subject, label=r.label, entered_by=actor)
            created += outcome == "created"
            updated += outcome == "updated"
            unchanged += outcome == "unchanged"
        write_audit_log(request, decoded, "import_applied", hashlib.sha256(csv_text.encode("utf-8")).hexdigest()[:32],
                        after={"rows": len(report.rows), "created": created, "updated": updated, "unchanged": unchanged},
                        target_type="verification_import")
    return import_summary(report, created, updated, unchanged)
