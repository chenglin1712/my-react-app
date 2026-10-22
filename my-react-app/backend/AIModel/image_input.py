"""AI 助手的圖片輸入（路線圖 #24）：學生拍課本、單字卡、標示牌問助手。

圖片只存在這一次請求的記憶體裡：不寫入資料庫或檔案、不進對話紀錄（後續輪次只留文字）、不寫進 log。
這是刻意的保守選擇——圖片可能拍到人臉、姓名等個資，沒有保存的必要就不保存。

前端會先縮圖壓成 JPEG，後端仍自己驗證一次：格式、大小、base64 是否合法，以及檔案開頭的標記
是否和宣告的格式相符（不信任前端；宣告 jpeg 實際卻是別的東西的請求直接擋掉）。
"""
import base64
import binascii
import io

from PIL import Image, UnidentifiedImageError
from rest_framework import serializers

IMAGE_FLAG = "ai_image_input_enabled"

# 解碼後的大小上限。前端縮圖後通常在 300KB 以內；Claude 對單張圖片的上限更高，
# 這裡抓小一點是為了控制每次請求的 token 成本與請求本文大小（Django 預設本文上限 2.5MB）。
MAX_IMAGE_BYTES = 1_000_000
# base64 長度約為原始大小的 4/3，序列化器先用字元數擋掉過大的本文，不必先解碼
MAX_IMAGE_BASE64_CHARS = MAX_IMAGE_BYTES // 3 * 4 + 8

# 宣告的格式 → 檔案開頭必須出現的標記。GIF 不收：動圖對辨識文字沒有幫助。
_SIGNATURES = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/webp": (b"RIFF",),                # 還要檢查第 8~12 個位元組是 WEBP
}


_PILLOW_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
# 邊長範圍：太小（幾個像素）辨識不了；前端縮圖後長邊約 1568，這裡放寬到 Claude 單邊上限 8000 以內
MIN_IMAGE_SIDE = 16
MAX_IMAGE_SIDE = 8000


def image_input_enabled() -> bool:
    """圖片輸入的功能旗標。【預設關閉、查不到旗標也視為關閉】：真金鑰驗收完才在後台「功能開關」開放。"""
    from adminapi.models import FeatureFlag

    flag = FeatureFlag.objects.filter(key=IMAGE_FLAG).first()
    return bool(flag is not None and flag.enabled)


class ChatImageSerializer(serializers.Serializer):
    media_type = serializers.ChoiceField(choices=list(_SIGNATURES))
    data = serializers.CharField(max_length=MAX_IMAGE_BASE64_CHARS, allow_blank=False, trim_whitespace=False)

    def validate(self, attrs):
        try:
            raw = base64.b64decode(attrs["data"], validate=True)
        except (binascii.Error, ValueError):
            raise serializers.ValidationError("圖片資料不是合法的 base64")
        if not 0 < len(raw) <= MAX_IMAGE_BYTES:
            raise serializers.ValidationError("圖片太大或是空的")
        if not raw.startswith(_SIGNATURES[attrs["media_type"]]):
            raise serializers.ValidationError("圖片內容和宣告的格式不符")
        if attrs["media_type"] == "image/webp" and raw[8:12] != b"WEBP":
            raise serializers.ValidationError("圖片內容和宣告的格式不符")
        _check_decodable(raw, attrs["media_type"])
        return attrs


def _check_decodable(raw: bytes, media_type: str) -> None:
    """開頭標記只能擋掉明顯不對的檔案；再用 Pillow 確認它真的是一張完整、格式相符、尺寸合理的圖片，
    不合格的請求在這裡就擋下，不必送到模型才失敗。只讀檔頭與結構（verify），不把整張圖解成像素。
    Pillow 的解壓炸彈保護（DecompressionBombError）也會在這裡生效。"""
    try:
        with Image.open(io.BytesIO(raw)) as img:
            if img.format != _PILLOW_FORMATS[media_type]:
                raise serializers.ValidationError("圖片內容和宣告的格式不符")
            width, height = img.size
            # 先看檔頭宣告的尺寸與是否動圖，不合格就不必往下驗證
            if not (MIN_IMAGE_SIDE <= min(width, height) and max(width, height) <= MAX_IMAGE_SIDE):
                raise serializers.ValidationError("圖片尺寸不合適")
            if getattr(img, "is_animated", False):
                raise serializers.ValidationError("不支援動態圖片")
            img.verify()                    # verify 之後這個物件不能再用，所以下面重新開啟
        with Image.open(io.BytesIO(raw)) as img:
            img.load()                      # 真的把像素解一次：結構正常但資料損毀的圖在這裡被擋下
    except serializers.ValidationError:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError, ValueError):
        raise serializers.ValidationError("圖片檔案損毀或無法讀取")


def image_block(image: dict) -> dict:
    """已驗證的圖片 → Messages API 的 image 內容區塊。"""
    return {"type": "image", "source": {"type": "base64", "media_type": image["media_type"], "data": image["data"]}}


def with_image(messages: list, image: dict | None) -> list:
    """把圖片放進最後一則使用者訊息，【圖片在文字之前】（官方建議的順序，辨識效果較好）。
    其他訊息（歷史）維持純文字，所以圖片不會被帶進之後的輪次。"""
    if not image:
        return messages
    last = messages[-1]
    return [*messages[:-1], {"role": "user", "content": [image_block(image), {"type": "text", "text": last["content"]}]}]
