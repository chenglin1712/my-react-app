"""共用的欄位驗證器。

驗證寫在模型欄位的 validators（不是只寫在 serializer）：DRF 的 ModelSerializer 會自動
套用，管理命令與測試也走同一份，不會因為換一條寫入路徑就繞過（見 HOMEPAGE_CONTRACT.md 3.1）。
"""
import re

from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator

# 單行文字：不接受任何控制字元（含換行、NUL、Tab）。
_SINGLE_LINE_BAD = re.compile(r"[\x00-\x1f\x7f]")
# 多行文字：只放行換行與 Tab，其餘控制字元（含 NUL）一律拒絕。
_MULTI_LINE_BAD = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def validate_single_line(value):
    if value and _SINGLE_LINE_BAD.search(value):
        raise ValidationError("不可包含換行或控制字元")


def validate_nonblank(value):
    # str.strip() 也會去掉全形空白（U+3000），所以只含空白的字串會被擋下。
    if not value or not value.strip():
        raise ValidationError("不可只包含空白")


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
