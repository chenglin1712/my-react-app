"""共用的欄位驗證器。

驗證寫在模型欄位的 validators（不是只寫在 serializer）：DRF 的 ModelSerializer 會自動
套用，管理命令與測試也走同一份，不會因為換一條寫入路徑就繞過（見 HOMEPAGE_CONTRACT.md 3.1）。
"""
import re

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
