"""共用的欄位驗證器。

驗證寫在模型欄位的 validators（不是只寫在 serializer）：DRF 的 ModelSerializer 會自動
套用，管理命令與測試也走同一份，不會因為換一條寫入路徑就繞過（見 HOMEPAGE_CONTRACT.md 3.1）。
"""
import os
import re
from urllib.parse import urlsplit

from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator

# 單行文字：不接受任何控制字元（含換行、NUL、Tab、C1 控制字元）與 Unicode 換行
# （U+2028、U+2029；U+0085 屬於 C1）。
_SINGLE_LINE_BAD = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]")
# 不可見字元：整串只有它們時看起來是空白卻能通過「非空」檢查，所以一律拒絕。
# 刻意不擋 ZWNJ／ZWJ（U+200C、U+200D）：沒有查證過所有族語書寫系統是否用到，寧可放行。
_INVISIBLE_BAD = re.compile(r"[\u200b\u2060\ufeff]")
# 雙向控制字元：純文字渲染防得了 XSS，防不了「文字順序被偽裝」的視覺欺騙。
# 一般的組合符號（族語的下點、底線等）不在此列，必須保留。
_BIDI_BAD = re.compile(r"[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]")
# 多行文字：只放行換行與 Tab，其餘控制字元（含 NUL）一律拒絕。
_MULTI_LINE_BAD = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def validate_single_line(value):
    if not value:
        return
    if _SINGLE_LINE_BAD.search(value):
        raise ValidationError("不可包含換行或控制字元")
    if _INVISIBLE_BAD.search(value):
        raise ValidationError("不可包含零寬等不可見字元")
    if _BIDI_BAD.search(value):
        raise ValidationError("不可包含雙向文字控制字元")


# 專題圖片只收 Cloudinary（沿用公告封面的上傳通道）。固定主機而不是任意 https：
# 任意外部圖片會讓第三方看到每位訪客的 IP，也讓日後 CSP 的 img-src 無法列白名單。
CLOUDINARY_IMAGE_HOST = "res.cloudinary.com"
_URL_BAD = re.compile(r"[\x00-\x20\x7f-\x9f\\\u2028\u2029\u200b\u2060\ufeff]")


_LINK_BAD = re.compile(r"[\x00-\x20\x7f-\x9f\u2028\u2029\u200b\u2060\ufeff]")
# 百分比編碼的控制字元與反斜線（%00 到 %1f、%7f、%5c）：不同層（nginx、Django、瀏覽器）正規化
# 結果可能不一致，直接拒絕，不去猜哪一層會怎麼解。
_ENCODED_BAD = re.compile(r"%(?:[01][0-9a-f]|7f|5c)", re.IGNORECASE)
# 路徑段若是 . 或 ..（含編碼寫法 %2e），可能在下游被正規化成別的路徑
_ENCODED_DOT = re.compile(r"%2e", re.IGNORECASE)


def validate_cloudinary_image_url(value):
    """https + 主機必須剛好是 res.cloudinary.com，不接受帳密、埠號、反斜線與空白。

    若後端設了 CLOUDINARY_CLOUD_NAME，路徑還必須以 /<cloud_name>/ 開頭，避免用別人帳號的圖。
    環境變數在驗證當下才讀，不在 import 時固定。
    """
    if not value:
        return
    if _URL_BAD.search(value) or _ENCODED_BAD.search(value):
        raise ValidationError("圖片網址含有不允許的字元")
    try:
        # urlsplit 本身也會對不合法的 IPv6 括號等丟 ValueError，整段解析都要包住
        parts = urlsplit(value)
        hostname = parts.hostname
        port = parts.port
    except ValueError:
        raise ValidationError("圖片網址格式不正確")
    if parts.scheme != "https" or (hostname or "") != CLOUDINARY_IMAGE_HOST:
        raise ValidationError(f"圖片必須是 https://{CLOUDINARY_IMAGE_HOST} 的網址")
    if parts.username is not None or parts.password is not None or port not in (None, 443):
        raise ValidationError("圖片網址不可含帳密或自訂埠號")
    # 路徑穿越：/mycloud/../othercloud/x 能通過前綴比較，但下游正規化後是別人的帳號
    if _ENCODED_DOT.search(parts.path) or any(seg in (".", "..") for seg in parts.path.split("/")):
        raise ValidationError("圖片網址路徑不可含 . 或 ..")
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME", "").strip()
    if cloud_name and not parts.path.startswith(f"/{cloud_name}/"):
        raise ValidationError("圖片不屬於本站的 Cloudinary 帳號")


def validate_internal_or_https_link(value):
    """內部路徑（/ 開頭且不是 //，反斜線先正規化）或 https 網址；擋掉 javascript: 之類的 scheme。

    與首頁主打圖連結（HomepageConfigSerializer.validate_hero_link_url）同一規則，
    但寫在模型欄位上，讓核准修改時的 full_clean() 也會重新檢查。
    """
    if not value:
        return
    if _LINK_BAD.search(value) or _ENCODED_BAD.search(value):
        raise ValidationError("連結含有不允許的字元")
    normalized = value.replace("\\", "/")
    if normalized.startswith("/") and not normalized.startswith("//"):
        return
    if value.startswith("https://"):
        try:
            parts = urlsplit(value)
            host = parts.hostname
            parts.port  # 觸發埠號格式檢查
        except ValueError:
            raise ValidationError("連結格式不正確")
        if host and parts.username is None and parts.password is None:
            return
    raise ValidationError("連結必須是內部路徑（以 / 開頭）或 https 網址，且不可含帳密")


def validate_nonblank(value):
    # str.strip() 也會去掉全形空白（U+3000），所以只含空白的字串會被擋下。
    if not value or not value.strip():
        raise ValidationError("不可只包含空白")


MAX_MARQUEE_ITEMS = 10
MAX_MARQUEE_ITEM_LENGTH = 40


def normalize_marquee_items(value):
    """跑馬燈的正規形：每項去前後空白（單一入口，serializer 與驗證共用）。

    不做 Unicode NFC 正規化：族語的組合符號寫法由使用者決定，專案對族語字型涵蓋有嚴格管控，
    不能在儲存時悄悄改寫字形。代價是長度以「碼位」計算，分解形式會比預組形式多占碼位。
    """
    return [item.strip() for item in value]


def validate_marquee_items(value):
    """跑馬燈項目：字串清單，最多 10 項，每項去空白後 1 到 40 字、單行（HOMEPAGE_CONTRACT.md 3.1）。

    這裡只檢查、不改值；儲存前的去空白正規化在 serializer。
    """
    if not isinstance(value, list):
        raise ValidationError("跑馬燈必須是文字清單")
    if len(value) > MAX_MARQUEE_ITEMS:
        raise ValidationError(f"跑馬燈最多 {MAX_MARQUEE_ITEMS} 項")
    if not all(isinstance(item, str) for item in value):
        for index, item in enumerate(value, start=1):
            if not isinstance(item, str):
                raise ValidationError(f"第 {index} 項必須是文字")
    for index, text in enumerate(normalize_marquee_items(value), start=1):
        if not text:
            raise ValidationError(f"第 {index} 項不可為空白")
        if len(text) > MAX_MARQUEE_ITEM_LENGTH:
            raise ValidationError(f"第 {index} 項最多 {MAX_MARQUEE_ITEM_LENGTH} 字")
        validate_single_line(text)


def validate_plain_text(value):
    if value and _MULTI_LINE_BAD.search(value):
        raise ValidationError("不可包含控制字元")


# 媒體檔只存「相對路徑」，格式固定：目錄、32 位十六進位檔名（uuid4 hex）、副檔名。
# 因此不可能含 scheme、//、反斜線、..、空位元組，也不可能指到外部網址。
# RegexValidator 用 re.search，所以兩端都要有 ^ 與 \Z：$ 會放行結尾多一個換行的字串。
PROMO_VIDEO_PATH_RE = r"^homepage/video/[0-9a-f]{32}\.mp4\Z"
PROMO_COVER_PATH_RE = r"^homepage/cover/[0-9a-f]{32}\.(jpg|webp)\Z"
PROMO_CAPTION_PATH_RE = r"^homepage/caption/[0-9a-f]{32}\.vtt\Z"

validate_promo_video_path = RegexValidator(PROMO_VIDEO_PATH_RE, "影片路徑格式不正確")
validate_promo_cover_path = RegexValidator(PROMO_COVER_PATH_RE, "封面路徑格式不正確")
validate_promo_caption_path = RegexValidator(PROMO_CAPTION_PATH_RE, "字幕路徑格式不正確")
