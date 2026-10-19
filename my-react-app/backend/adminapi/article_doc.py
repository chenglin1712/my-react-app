"""專題文章內容（富文字編輯器產生的 TipTap／ProseMirror 文件）的白名單驗證。

為什麼存 JSON 而不是 HTML：
- 內文由編輯者在後台寫、所有訪客都會讀。存 HTML 就一定要在伺服器端做 HTML 清理（這個專案沒有也不打算引進
  那條依賴），清理規則一漏就是存放型 XSS。
- 存「文件樹」則只有白名單裡的節點與屬性能存進來，前台用 React 逐節點渲染成元素與文字節點，整條路徑從頭到尾
  沒有任何 HTML 字串，也就沒有可被注入的東西。

這裡的規則要與前台渲染器（frontend/components/_topic/RichTextRenderer.jsx）能渲染的節點一致：驗證放行、
渲染器卻不認得的節點會被略過；渲染器認得、驗證卻不放行的則根本存不進來。

只放行：段落、標題（2 到 3 級）、粗體／斜體／底線／刪除線、連結、項目與編號清單、引用、分隔線、換行、圖片。
圖片只收 Cloudinary；連結只收站內路徑與 https。
"""
import json

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
MAX_ALT_CHARS = 200
MAX_CAPTION_CHARS = 120

_INLINE = {"text", "hardBreak"}
_BLOCK_LEAF = {"horizontalRule", "image"}
_CONTAINERS = {
    # 節點 -> 允許的子節點
    "doc": {"paragraph", "heading", "bulletList", "orderedList", "blockquote", "horizontalRule", "image"},
    "paragraph": _INLINE,
    "heading": _INLINE,
    "blockquote": {"paragraph", "heading", "bulletList", "orderedList", "horizontalRule", "image"},
    "bulletList": {"listItem"},
    "orderedList": {"listItem"},
    "listItem": {"paragraph", "bulletList", "orderedList"},
}
_ALLOWED_ATTRS = {
    "doc": set(),
    "paragraph": set(),
    "heading": {"level"},
    "blockquote": set(),
    "bulletList": set(),
    "orderedList": {"start", "type"},
    "listItem": set(),
    "horizontalRule": set(),
    "hardBreak": set(),
    "text": set(),
    "image": {"src", "alt", "title"},
}
_MARKS = {"bold", "italic", "underline", "strike", "link"}
_MARK_ATTRS = {"bold": set(), "italic": set(), "underline": set(), "strike": set(), "link": {"href", "target", "rel", "class", "title"}}


def _fail(message):
    raise ValidationError(message)


class _Stats:
    def __init__(self):
        self.nodes = 0
        self.text = 0
        self.images = 0
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
        if kind == "link":
            href = attrs.get("href")
            if not isinstance(href, str) or not href.strip():
                _fail("連結缺少網址")
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
    if kind == "heading":
        if attrs.get("level") not in (2, 3):
            _fail("標題只能是 2 到 3 級")
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
