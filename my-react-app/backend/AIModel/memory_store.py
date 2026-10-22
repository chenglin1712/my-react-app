"""AI 助手的學習記憶（路線圖 #21）：Anthropic 記憶工具（memory_20250818）的用戶端實作。

記憶工具是「用戶端工具」：模型只提出 view / create / str_replace / insert / delete / rename，
由我們自己執行並把結果回給模型。檔案存在資料庫（adminapi.LearnerMemoryFile），每個 uid 一份，
查詢一律帶 uid 條件，不同學習者互相看不到。

安全設計（官方文件要求每個路徑都要驗證）：
- 路徑必須是 /memories 本身或以 /memories/ 開頭；拒絕 ..、反斜線、%（URL 編碼）、控制字元、隱藏檔（. 開頭）、
  連續斜線、過深或過長的路徑；各層名稱只允許文字、數字、底線、連字號、點與空白。
  存的是「相對 /memories 的路徑」，不會碰到真正的檔案系統，所以沒有符號連結問題。
- 內容只存學習相關的文字：拒絕網址、電子郵件、電話號碼、疑似金鑰，單檔與檔案數有上限。
  這是第二道防線；第一道是 system prompt 要求只記學習狀況（services.MEMORY_PROMPT）。
- 模型寫入的內容之後會被讀回 prompt，所以讀出來的內容一律視為資料（見 services 的說明）。
- 預設關閉；要同意（LearnerMemoryConsent）才會啟用，撤回或關閉就刪光（clear_all）。
"""
import datetime
import logging
import re
import unicodedata

from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

ROOT = "/memories"
CONSENT_VERSION = "2026-10-v1"
RETENTION_DAYS = 180

MAX_FILES = 20
MAX_FILE_CHARS = 4000
MAX_PATH_CHARS = 120
MAX_DEPTH = 3                 # 目錄層數 + 檔名
MAX_VIEW_CHARS = 16000        # 官方文件：view 超過 16,000 字會截斷，可用 view_range 分段讀
MAX_VIEW_LINES = 999_999

_SEGMENT = re.compile(r"^[\w一-鿿][\w一-鿿 .\-]*$")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# 不該進記憶的內容：網址、電子郵件、長數字（電話、證號）、疑似金鑰
_SENSITIVE = [
    (re.compile(r"https?://|www\.", re.I), "網址"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "電子郵件"),
    (re.compile(r"(?<!\d)\d[\d\s\-]{7,}\d(?!\d)"), "長串數字（像電話或證號）"),
    (re.compile(r"\b(sk|pk|key|token|secret)[-_][A-Za-z0-9_\-]{8,}", re.I), "疑似金鑰"),
    # 記憶會在之後的對話被讀回模型，所以擋掉明顯想對模型下指令的文字（只是輔助防線，主要防線是把讀回的內容當資料）
    (re.compile(r"ignore\s+(all\s+|the\s+)?(previous|above|prior)|system\s+prompt|忽略(以上|之前|先前|上述|所有)|系統提示|無視(以上|之前|規則)", re.I), "給模型的指令"),
]


class MemoryError_(Exception):
    """記憶工具的可預期錯誤；訊息會原樣回給模型（is_error），所以只寫規則，不含不可信內容的原文。"""


def _models():
    from adminapi.models import LearnerMemoryConsent, LearnerMemoryFile
    return LearnerMemoryConsent, LearnerMemoryFile


# ---------------------------------------------------------------- 路徑

def normalize(path) -> str:
    """把模型給的路徑轉成相對 /memories 的存放路徑（根目錄是空字串）；不合法就丟 MemoryError_。"""
    if not isinstance(path, str) or not path or len(path) > MAX_PATH_CHARS:
        raise MemoryError_("路徑不合法")
    path = unicodedata.normalize("NFC", path)       # 視覺相同的寫法（組合字元）只算同一個路徑
    if _CONTROL.search(path) or "\\" in path or "%" in path or "//" in path:
        raise MemoryError_("路徑不合法")
    if path != ROOT and not path.startswith(ROOT + "/"):
        raise MemoryError_(f"路徑必須在 {ROOT} 之下")
    rest = path[len(ROOT):].strip("/")
    if not rest:
        return ""
    segments = rest.split("/")
    if len(segments) > MAX_DEPTH:
        raise MemoryError_("路徑層數太深")
    for seg in segments:
        if (seg in ("", ".", "..") or seg.startswith(".") or seg != seg.strip() or seg.endswith(".")
                or seg == "node_modules" or not _SEGMENT.match(seg)):
            raise MemoryError_("路徑不合法")
    return "/".join(segments)


def _virtual(rel: str) -> str:
    return f"{ROOT}/{rel}" if rel else ROOT


# ---------------------------------------------------------------- 內容檢查

def check_content(text) -> str:
    """回傳可以存的文字；有不該存的內容就丟 MemoryError_。"""
    if not isinstance(text, str):
        raise MemoryError_("內容必須是文字")
    if len(text) > MAX_FILE_CHARS:
        raise MemoryError_(f"單一檔案不能超過 {MAX_FILE_CHARS} 字，請精簡或拆成多個檔案")
    if _CONTROL.search(text):
        raise MemoryError_("內容含有不允許的字元")
    for pattern, label in _SENSITIVE:
        if pattern.search(text):
            raise MemoryError_(f"記憶只能記學習相關內容，不能包含{label}")
    return text


# ---------------------------------------------------------------- 功能旗標與同意

FEATURE_FLAG = "ai_learner_memory_enabled"


def feature_enabled() -> bool:
    """學習記憶的功能旗標。【預設關閉、查不到旗標也視為關閉】（fail-closed）；旗標只決定能不能新開始使用與是否注入聊天，
    關閉時學生仍可檢視、清除自己已存的記憶。"""
    from adminapi.models import FeatureFlag

    flag = FeatureFlag.objects.filter(key=FEATURE_FLAG).first()
    return bool(flag is not None and flag.enabled)


def active_for(uid: str) -> bool:
    """這位學生的聊天要不要接上記憶工具：功能開著，且他自己同意了目前版本。"""
    return feature_enabled() and has_consent(uid)


def _lock(uid: str) -> bool:
    """在交易內鎖住這位使用者的同意列，讓同一人的記憶操作一次只跑一個（檔案數上限、上層路徑檢查、
    編輯都是「先讀再寫」，不序列化的話兩個同時進來的請求會突破上限或互相覆蓋）。
    回傳這位使用者目前是否同意（在鎖內判斷，撤回與寫入不會交錯）。SQLite（測試）沒有列鎖，單執行緒不受影響。"""
    consent_model, _ = _models()
    row = consent_model.objects.select_for_update().filter(uid=uid).first()
    return bool(row and row.consent_version == CONSENT_VERSION)


def has_consent(uid: str) -> bool:
    if not uid:
        return False
    consent_model, _ = _models()
    return consent_model.objects.filter(uid=uid, consent_version=CONSENT_VERSION).exists()


def grant_consent(uid: str) -> None:
    consent_model, _ = _models()
    consent_model.objects.update_or_create(
        uid=uid, defaults={"consent_version": CONSENT_VERSION, "granted_at": timezone.now()})


@transaction.atomic
def revoke_consent(uid: str) -> int:
    """撤回同意：刪掉同意紀錄與全部記憶，回傳刪掉的檔案數。"""
    consent_model, _ = _models()
    _lock(uid)
    removed = clear_all(uid)
    consent_model.objects.filter(uid=uid).delete()
    return removed


@transaction.atomic
def clear_all(uid: str) -> int:
    _lock(uid)                  # 和 AI 的寫入、使用者編輯序列化，清除後不會又冒出檔案
    _, file_model = _models()
    count, _ = file_model.objects.filter(uid=uid).delete()
    return count


# ---------------------------------------------------------------- 讀取（給使用者頁面與匯出）

def list_files(uid: str) -> list:
    _, file_model = _models()
    return [
        {"path": f.path, "content": f.content, "updated_at": f.updated_at.isoformat()}
        for f in file_model.objects.filter(uid=uid).order_by("path")
    ]


def _human_size(n: int) -> str:
    if n < 1024:
        return f"{n}B"
    value = n / 1024
    return f"{value:.1f}K" if value < 1024 else f"{value / 1024:.1f}M"


# ---------------------------------------------------------------- 指令

def _get(uid: str, rel: str):
    _, file_model = _models()
    return file_model.objects.filter(uid=uid, path=rel).first()


def _is_dir(uid: str, rel: str) -> bool:
    _, file_model = _models()
    return rel == "" or file_model.objects.filter(uid=uid, path__startswith=rel + "/").exists()


def _numbered(text: str, start: int = 1) -> str:
    return "\n".join(f"{i:6d}\t{line}" for i, line in enumerate(text.split("\n"), start))


def _view(uid: str, path: str, view_range=None) -> str:
    rel = normalize(path)
    _, file_model = _models()
    f = _get(uid, rel) if rel else None
    if f is not None:
        lines = f.content.split("\n")
        if len(lines) > MAX_VIEW_LINES:
            return f"File {path} exceeds maximum line limit of 999,999 lines."
        first = 1
        if isinstance(view_range, list) and len(view_range) == 2 and all(isinstance(x, int) for x in view_range):
            start, end = view_range
            end = len(lines) if end == -1 else end
            if start < 1 or end < start or start > len(lines):
                raise MemoryError_("view_range 超出檔案範圍")
            lines = lines[start - 1:end]
            first = start
        body = _numbered("\n".join(lines), first)
        if len(body) > MAX_VIEW_CHARS:
            body = body[:MAX_VIEW_CHARS] + "\n（內容過長已截斷，請用 view_range 分段讀取）"
        return f"Here's the content of {path} with line numbers:\n{body}"
    if not _is_dir(uid, rel):
        return f"The path {path} does not exist. Please provide a valid path."
    prefix = rel + "/" if rel else ""
    entries = []
    for item in file_model.objects.filter(uid=uid, path__startswith=prefix).order_by("path"):
        parts = item.path[len(prefix):].split("/")
        entries.append((prefix + "/".join(parts[:2]) if len(parts) > 1 else item.path, len(item.content.encode("utf-8")), len(parts) > 1))
    total = sum(size for _, size, _ in entries)
    listing = [f"{_human_size(total)}\t{path}"]
    seen = set()
    for name, size, nested in entries:
        key = name
        if key in seen:
            continue
        seen.add(key)
        shown = sum(s for n, s, _ in entries if n == name) if nested else size
        listing.append(f"{_human_size(shown)}\t{_virtual(name)}")
    return (f"Here're the files and directories up to 2 levels deep in {path}, "
            f"excluding hidden items and node_modules:\n" + "\n".join(listing))


def _create(uid: str, path: str, file_text) -> str:
    rel = normalize(path)
    if not rel:
        raise MemoryError_("不能對根目錄建立檔案")
    text = check_content(file_text)
    if _is_dir(uid, rel):
        raise MemoryError_("這個路徑是目錄，不是檔案")
    _, file_model = _models()
    existing = _get(uid, rel)
    if existing is None:
        if file_model.objects.filter(uid=uid).count() >= MAX_FILES:
            raise MemoryError_(f"最多只能有 {MAX_FILES} 個檔案，請先刪除或合併不需要的檔案")
        # 父路徑不能是已存在的檔案（否則會出現「檔案同時是目錄」）
        parts = rel.split("/")
        for i in range(1, len(parts)):
            if _get(uid, "/".join(parts[:i])) is not None:
                raise MemoryError_("上層路徑已經是檔案")
        file_model.objects.create(uid=uid, path=rel, content=text)
    else:
        existing.content = text
        existing.save(update_fields=["content", "updated_at"])
    return f"File created successfully at: {path}"


def _str_replace(uid: str, path: str, old_str, new_str) -> str:
    rel = normalize(path)
    f = _get(uid, rel) if rel else None
    if f is None:
        return f"Error: The path {path} does not exist. Please provide a valid path."
    if not isinstance(old_str, str) or not old_str:
        raise MemoryError_("old_str 不能是空的")
    new_text = "" if new_str is None else new_str
    count = f.content.count(old_str)
    if count == 0:
        return f"No replacement was performed, old_str `{old_str[:80]}` did not appear verbatim in {path}."
    if count > 1:
        numbers = [str(i) for i, line in enumerate(f.content.split("\n"), 1) if old_str in line]
        return (f"No replacement was performed. Multiple occurrences of old_str `{old_str[:80]}` "
                f"in lines: {', '.join(numbers)}. Please ensure it is unique")
    f.content = check_content(f.content.replace(old_str, new_text, 1))
    f.save(update_fields=["content", "updated_at"])
    return "The memory file has been edited."


def _insert(uid: str, path: str, insert_line, insert_text) -> str:
    rel = normalize(path)
    f = _get(uid, rel) if rel else None
    if f is None:
        return f"Error: The path {path} does not exist"
    lines = f.content.split("\n")
    if not isinstance(insert_line, int) or isinstance(insert_line, bool) or insert_line < 0 or insert_line > len(lines):
        return (f"Error: Invalid `insert_line` parameter: {insert_line}. "
                f"It should be within the range of lines of the file: [0, {len(lines)}]")
    if not isinstance(insert_text, str):
        raise MemoryError_("insert_text 必須是文字")
    lines[insert_line:insert_line] = [insert_text.rstrip("\n")]
    f.content = check_content("\n".join(lines))
    f.save(update_fields=["content", "updated_at"])
    return f"The file {path} has been edited."


def _delete(uid: str, path: str) -> str:
    rel = normalize(path)
    if not rel:
        raise MemoryError_("不能刪除根目錄")
    _, file_model = _models()
    query = file_model.objects.filter(uid=uid, path=rel) | file_model.objects.filter(uid=uid, path__startswith=rel + "/")
    deleted, _ = query.delete()
    if not deleted:
        return f"Error: The path {path} does not exist"
    return f"Successfully deleted {path}"


def _rename(uid: str, old_path: str, new_path: str) -> str:
    old, new = normalize(old_path), normalize(new_path)
    if not old or not new:
        raise MemoryError_("不能重新命名根目錄")
    _, file_model = _models()
    moving = list(file_model.objects.filter(uid=uid, path=old)) + list(file_model.objects.filter(uid=uid, path__startswith=old + "/"))
    if not moving:
        return f"Error: The path {old_path} does not exist"
    if new == old or new.startswith(old + "/") or _get(uid, new) is not None or _is_dir(uid, new):
        return f"Error: The destination {new_path} already exists"
    for i in range(1, len(new.split("/"))):
        if _get(uid, "/".join(new.split("/")[:i])) is not None:
            raise MemoryError_("上層路徑已經是檔案")
    for f in moving:
        suffix = f.path[len(old):]
        target = new + suffix
        normalize(_virtual(target))        # 和一般輸入同一套檢查（層數、完整路徑長度），改名後不會產生再也讀不到的檔案
        f.path = target
        f.save(update_fields=["path", "updated_at"])
    return f"Successfully renamed {old_path} to {new_path}"


@transaction.atomic
def execute(uid: str, tool_input) -> str:
    """執行模型的一個記憶工具呼叫，回傳要放進 tool_result 的文字。不合法的呼叫丟 MemoryError_（呼叫端以 is_error 回報）。
    沒有同意就一律拒絕，即使呼叫端漏判也不會讀寫。"""
    if not _lock(uid):
        raise MemoryError_("學習者尚未同意使用學習記憶")
    if not isinstance(tool_input, dict):
        raise MemoryError_("工具參數不合法")
    command = tool_input.get("command")
    if command == "view":
        return _view(uid, tool_input.get("path"), tool_input.get("view_range"))
    if command == "create":
        return _create(uid, tool_input.get("path"), tool_input.get("file_text"))
    if command == "str_replace":
        return _str_replace(uid, tool_input.get("path"), tool_input.get("old_str"), tool_input.get("new_str"))
    if command == "insert":
        return _insert(uid, tool_input.get("path"), tool_input.get("insert_line"), tool_input.get("insert_text"))
    if command == "delete":
        return _delete(uid, tool_input.get("path"))
    if command == "rename":
        return _rename(uid, tool_input.get("old_path"), tool_input.get("new_path"))
    raise MemoryError_("不支援的指令")


# ---------------------------------------------------------------- 使用者自己編輯（我的學習記憶頁）

@transaction.atomic
def save_user_file(uid: str, rel_path: str, content) -> None:
    """使用者在頁面上修改一個檔案；走同樣的路徑與內容檢查（路徑以 /memories/ 開頭的形式驗證）。"""
    if not _lock(uid):
        raise MemoryError_("尚未同意使用學習記憶")
    normalized = normalize(_virtual(rel_path))
    if not normalized:
        raise MemoryError_("路徑不合法")
    text = check_content(content)
    f = _get(uid, normalized)
    if f is None:
        raise MemoryError_("找不到這個檔案")
    f.content = text
    f.save(update_fields=["content", "updated_at"])


@transaction.atomic
def delete_user_file(uid: str, rel_path: str) -> bool:
    _lock(uid)
    normalized = normalize(_virtual(rel_path))
    if not normalized:
        raise MemoryError_("路徑不合法")
    _, file_model = _models()
    deleted, _ = file_model.objects.filter(uid=uid, path=normalized).delete()
    return bool(deleted)


# ---------------------------------------------------------------- 保存期限

def purge_expired(now=None, days: int = RETENTION_DAYS) -> int:
    """刪掉最後一次更新超過期限的記憶檔，回傳刪掉的檔案數。"""
    _, file_model = _models()
    cutoff = (now or timezone.now()) - datetime.timedelta(days=days)
    deleted, _ = file_model.objects.filter(updated_at__lt=cutoff).delete()
    return deleted
