"""專題文章內容（富文字編輯器產生的 TipTap／ProseMirror 文件）的白名單驗證。

為什麼存 JSON 而不是 HTML：
- 內文由編輯者在後台寫、所有訪客都會讀。存 HTML 就一定要在伺服器端做 HTML 清理（這個專案沒有也不打算引進
  那條依賴），清理規則一漏就是存放型 XSS。
- 存「文件樹」則只有白名單裡的節點與屬性能存進來，前台用 React 逐節點渲染成元素與文字節點，整條路徑從頭到尾
  沒有任何 HTML 字串，也就沒有可被注入的東西。

這裡的規則要與前台渲染器（frontend/components/_topic/RichTextRenderer.jsx）能渲染的節點一致：驗證放行、
渲染器卻不認得的節點會被略過；渲染器認得、驗證卻不放行的則根本存不進來。

只放行：段落、標題（2 到 4 級）、對齊、粗體／斜體／底線／刪除線／上標／下標、固定色盤的文字色與螢光筆、三種字級、
連結、項目／編號／待辦清單、引用、重點提示框、表格、YouTube 影片、分隔線、換行、圖片（可設對齊與大小）。
圖片只收 Cloudinary；連結只收站內路徑、https 與單純的 mailto；影片只收 YouTube 影片代號。
所有「選項型」屬性（顏色、字級、對齊、提示框種類…）都只收固定清單裡的值，不收任意 CSS。
"""
import json
import re

from django.core.exceptions import ValidationError

from .validators import (
    _BIDI_BAD,
    _INVISIBLE_BAD,
    _MULTI_LINE_BAD,
    validate_cloudinary_image_url,
    validate_internal_or_https_link,
    validate_single_line,
)

MAX_JSON_CHARS = 300_000
MAX_DEPTH = 8
MAX_NODES = 5_000
MAX_TEXT_CHARS = 50_000
MAX_IMAGES = 40
MAX_VIDEOS = 10
MAX_TABLE_ROWS = 50
MAX_TABLE_COLS = 12
MAX_SPAN = 12
MAX_ALT_CHARS = 200
MAX_CAPTION_CHARS = 120

_INLINE = {"text", "hardBreak"}
_LISTS = {"bulletList", "orderedList", "taskList"}
_CONTAINERS = {
    # 節點 -> 允許的子節點。編輯器端（articleExtensions.js）的 schema 要收在同樣的範圍裡，編輯時就做不出存不進去的內容。
    "doc": {"paragraph", "heading", "blockquote", "horizontalRule", "image", "table", "callout", "youtube"} | _LISTS,
    "paragraph": _INLINE,
    "heading": _INLINE,
    "blockquote": {"paragraph", "heading", "horizontalRule", "image"} | _LISTS,
    "callout": {"paragraph"} | _LISTS,
    "bulletList": {"listItem"},
    "orderedList": {"listItem"},
    "taskList": {"taskItem"},
    "listItem": {"paragraph", "bulletList", "orderedList"},
    "taskItem": {"paragraph", "bulletList", "orderedList", "taskList"},
    "table": {"tableRow"},
    "tableRow": {"tableCell", "tableHeader"},
    "tableCell": {"paragraph", "bulletList", "orderedList"},
    "tableHeader": {"paragraph", "bulletList", "orderedList"},
}
_ALLOWED_ATTRS = {
    "doc": set(),
    "paragraph": {"textAlign"},
    "heading": {"level", "textAlign"},
    "blockquote": set(),
    "callout": {"tone"},
    "bulletList": set(),
    "orderedList": {"start", "type"},
    "taskList": set(),
    "listItem": set(),
    "taskItem": {"checked"},
    "table": set(),
    "tableRow": set(),
    "tableCell": {"colspan", "rowspan", "colwidth"},
    "tableHeader": {"colspan", "rowspan", "colwidth"},
    "horizontalRule": set(),
    "hardBreak": set(),
    "text": set(),
    "image": {"src", "alt", "title", "align", "size"},
    "youtube": {"videoId", "title"},
}
# 選項型屬性只收固定清單（與前台 richText.js 的常數一致）
_ALIGNS = {"left", "center", "right", "justify"}
_TONES = {"info", "success", "warning", "danger"}
_TEXT_COLORS = {"red", "orange", "green", "blue", "purple", "gray"}
_HIGHLIGHT_COLORS = {"yellow", "green", "blue", "pink", "gray"}
_FONT_SIZES = {"sm", "lg", "xl"}
_IMAGE_ALIGNS = {"left", "center", "right"}
_IMAGE_SIZES = {"sm", "md", "lg", "full"}
_YOUTUBE_ID = re.compile(r"[A-Za-z0-9_-]{11}")
_MARKS = {"bold", "italic", "underline", "strike", "subscript", "superscript", "link", "textColor", "highlight", "fontSize"}
_MARK_ATTRS = {
    "bold": set(), "italic": set(), "underline": set(), "strike": set(), "subscript": set(), "superscript": set(),
    "link": {"href", "target", "rel", "class", "title"},
    "textColor": {"color"}, "highlight": {"color"}, "fontSize": {"size"},
}


def _fail(message):
    raise ValidationError(message)


class _Stats:
    def __init__(self):
        self.nodes = 0
        self.text = 0
        self.images = 0
        self.videos = 0
        self.has_content = False


def _check_attrs(kind, attrs, allowed):
    if attrs is None:
        return {}
    if not isinstance(attrs, dict):
        _fail(f"{kind} 的屬性格式不正確")
    extra = set(attrs) - allowed
    if extra:
        _fail(f"{kind} 含有不允許的屬性：{'、'.join(sorted(extra))}")
    return attrs


def _check_text(value):
    if not isinstance(value, str):
        _fail("文字內容格式不正確")
    if _MULTI_LINE_BAD.search(value) or "\n" in value or "\r" in value:
        _fail("文字內容不可包含控制字元或換行（換行請用換行節點）")
    if _INVISIBLE_BAD.search(value) or _BIDI_BAD.search(value):
        _fail("文字內容含有不可見或雙向控制字元")


# 只收「mailto:」加單一信箱，不收 ?subject=、多個收件人或其他參數
_MAILTO = re.compile(r"^mailto:[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")


def _check_mailto(href):
    if len(href) > 254 or not _MAILTO.fullmatch(href):
        _fail("電子郵件連結格式不正確，請用 mailto:信箱")


def _check_choice(value, allowed, label, required=False):
    if value is None and not required:
        return
    # 先確認是字串：list／dict 不可雜湊，直接拿去查集合會丟 TypeError 變成 500
    if not isinstance(value, str) or value not in allowed:
        _fail(f"{label}不在允許的選項內")


_MARK_CHOICES = {
    "textColor": ("color", _TEXT_COLORS, "文字顏色"),
    "highlight": ("color", _HIGHLIGHT_COLORS, "螢光筆顏色"),
    "fontSize": ("size", _FONT_SIZES, "字級"),
}


def _check_marks(marks):
    if marks is None:
        return
    if not isinstance(marks, list):
        _fail("文字樣式格式不正確")
    for mark in marks:
        if not isinstance(mark, dict) or mark.get("type") not in _MARKS:
            _fail("含有不允許的文字樣式")
        kind = mark["type"]
        attrs = _check_attrs(kind, mark.get("attrs"), _MARK_ATTRS[kind])
        if kind in _MARK_CHOICES:
            key, allowed, label = _MARK_CHOICES[kind]
            _check_choice(attrs.get(key), allowed, label, required=True)
        if kind == "link":
            href = attrs.get("href")
            if not isinstance(href, str) or not href.strip():
                _fail("連結缺少網址")
            if href.startswith("mailto:"):
                _check_mailto(href)
            else:
                validate_internal_or_https_link(href)
            if attrs.get("target") not in (None, "_blank", "_self"):
                _fail("連結的開啟方式不正確")
            # rel／class／title 只是 TipTap 預設會帶的值，前台不採用（外部連結一律固定 noopener）；
            # 仍限制型別、長度與字元，不讓它們變成可夾帶任意內容的欄位
            for key in ("rel", "class", "title"):
                value = attrs.get(key)
                if value is None:
                    continue
                if not isinstance(value, str) or len(value) > MAX_ALT_CHARS:
                    _fail(f"連結的 {key} 格式不正確")
                validate_single_line(value)


def _walk(node, parent_kind, depth, stats):
    if depth > MAX_DEPTH:
        _fail(f"內容層級太深（最多 {MAX_DEPTH} 層）")
    if not isinstance(node, dict):
        _fail("內容節點格式不正確")
    kind = node.get("type")
    if not isinstance(kind, str) or kind not in _ALLOWED_ATTRS:
        _fail(f"含有不允許的內容類型：{kind!r}")
    if parent_kind is not None and kind not in _CONTAINERS[parent_kind]:
        _fail(f"{parent_kind} 裡不能放 {kind}")
    stats.nodes += 1
    if stats.nodes > MAX_NODES:
        _fail(f"內容太長（節點超過 {MAX_NODES} 個）")

    attrs = _check_attrs(kind, node.get("attrs"), _ALLOWED_ATTRS[kind])

    if kind == "text":
        text = node.get("text")
        _check_text(text)
        stats.text += len(text)
        if text.strip():
            stats.has_content = True
        _check_marks(node.get("marks"))
        if node.get("content"):
            _fail("文字節點不能有子節點")
        return
    if node.get("marks"):
        _fail(f"{kind} 不能設定文字樣式")
    if kind in ("paragraph", "heading"):
        _check_choice(attrs.get("textAlign"), _ALIGNS, "對齊方式")
    if kind == "heading":
        if attrs.get("level") not in (2, 3, 4):
            _fail("標題只能是 2 到 4 級")
    elif kind == "callout":
        _check_choice(attrs.get("tone"), _TONES, "提示框種類", required=True)
    elif kind == "taskItem":
        if attrs.get("checked") is not None and not isinstance(attrs["checked"], bool):
            _fail("待辦項目的狀態不正確")
    elif kind in ("tableCell", "tableHeader"):
        for key in ("colspan", "rowspan"):
            value = attrs.get(key)
            if value is not None and (not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= MAX_SPAN):
                _fail("表格儲存格的合併範圍不正確")
        if attrs.get("colwidth") is not None:
            _fail("表格不支援自訂欄寬")
    elif kind == "table":
        rows = node.get("content") or []
        if len(rows) > MAX_TABLE_ROWS:
            _fail(f"表格最多 {MAX_TABLE_ROWS} 列")
    elif kind == "tableRow":
        if len(node.get("content") or []) > MAX_TABLE_COLS:
            _fail(f"表格最多 {MAX_TABLE_COLS} 欄")
    elif kind == "youtube":
        video_id = attrs.get("videoId")
        if not isinstance(video_id, str) or not _YOUTUBE_ID.fullmatch(video_id):
            _fail("YouTube 影片代號不正確")
        title = attrs.get("title")
        if title is not None:
            if not isinstance(title, str) or len(title) > MAX_CAPTION_CHARS:
                _fail(f"影片說明最多 {MAX_CAPTION_CHARS} 字")
            validate_single_line(title)
        stats.videos += 1
        stats.has_content = True
        if stats.videos > MAX_VIDEOS:
            _fail(f"影片太多（最多 {MAX_VIDEOS} 支）")
    elif kind == "orderedList":
        if attrs.get("start") is not None and (not isinstance(attrs["start"], int) or isinstance(attrs["start"], bool) or not 1 <= attrs["start"] <= 9999):
            _fail("編號清單的起始數字不正確")
        if attrs.get("type") not in (None, "1", "a", "A", "i", "I"):
            _fail("編號清單的類型不正確")
    elif kind == "image":
        src = attrs.get("src")
        if not isinstance(src, str) or not src:
            _fail("圖片缺少網址")
        validate_cloudinary_image_url(src)
        _check_choice(attrs.get("align"), _IMAGE_ALIGNS, "圖片對齊方式")
        _check_choice(attrs.get("size"), _IMAGE_SIZES, "圖片大小")
        for key, limit in (("alt", MAX_ALT_CHARS), ("title", MAX_CAPTION_CHARS)):
            value = attrs.get(key)
            if value is None:
                continue
            if not isinstance(value, str) or len(value) > limit:
                _fail(f"圖片的{'替代文字' if key == 'alt' else '圖說'}最多 {limit} 字")
            validate_single_line(value)
        stats.images += 1
        stats.has_content = True
        if stats.images > MAX_IMAGES:
            _fail(f"圖片太多（最多 {MAX_IMAGES} 張）")

    children = node.get("content")
    if children is None:
        children = []
    if not isinstance(children, list):
        _fail("子節點格式不正確")
    if kind not in _CONTAINERS and children:
        _fail(f"{kind} 不能有子節點")
    for child in children:
        _walk(child, kind, depth + 1, stats)


def analyze_article_doc(doc):
    """驗證並回傳統計；不合法就丟 ValidationError。空值（None、{}）視為「沒有內容」，是合法的。"""
    stats = _Stats()
    if doc in (None, {}, ""):
        return stats
    if not isinstance(doc, dict) or doc.get("type") != "doc":
        _fail("內容格式不正確，必須是編輯器產生的文件")
    # 先走訪（深度與節點數超限會立刻中止），再算序列化大小：極深的巢狀不會先在 json.dumps 炸出 RecursionError
    _walk(doc, None, 0, stats)
    try:
        size = len(json.dumps(doc, ensure_ascii=False))
    except (TypeError, ValueError, RecursionError):
        _fail("內容格式不正確")
    if size > MAX_JSON_CHARS:
        _fail("內容太長，請縮短或分成多篇")
    if stats.text > MAX_TEXT_CHARS:
        _fail(f"內文最多 {MAX_TEXT_CHARS} 字")
    return stats


def validate_article_doc(value):
    analyze_article_doc(value)


def article_has_content(doc):
    """有沒有可讀內容（至少一個非空白文字或一張圖）。給公開端點與後台判斷「這篇是不是空的」。"""
    try:
        return analyze_article_doc(doc).has_content
    except ValidationError:
        return False
