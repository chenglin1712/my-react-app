"""下載內容的真實格式判斷——純函式，不做任何 I/O，只看 bytes 本身。上游的
Content-Type header 不可盡信（可能回一個 200 的 HTML 防爬頁或 JSON 錯誤內容，
header 仍宣稱是 audio/image），所以下載端一律用這裡的簽章比對結果，不信任
header。"""

_IMAGE_SIGNATURES = [
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
]
_EXTENSION_BY_CONTENT_TYPE = {
    "audio/mpeg": ".mp3",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


def _sniff_webp(data: bytes):
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _looks_like_mp3_frame(data: bytes) -> bool:
    """MP3 frame sync：第一個 byte 是 0xFF，第二個 byte 高 3 位元也全是 1
    （11-bit sync word）。其餘位元（MPEG version／layer／protection）有很多
    種合法組合，不窮舉列成清單——pilot 實測 ILRDF 回來的音檔開頭是
    b'\\xff\\xfa'（MPEG-1 Layer III + CRC 保護），一開始只列了
    \\xfb/\\xf3/\\xf2 幾種常見組合，沒列到這種，被誤判成「不是音訊格式」而
    直接 terminal 失敗——改成檢查 sync word 本身，不管後面的版本/layer/
    保護位元組合是哪一種，才是正確、不會漏判的做法。"""
    return len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0


def _sniff_content_type(data: bytes, family: str):
    """只在對應家族（audio/image）的簽章裡比對，找不到回傳 None——呼叫端會把
    None 當成驗證失敗直接判 terminal，不會退回去相信上游的 Content-Type
    header。上游完全可能回一個 200 的 HTML 防爬頁或 JSON 錯誤內容，header
    宣稱是 audio/image 也不能盡信，一定要看真正的 bytes。"""
    if family == "audio":
        if data.startswith(b"ID3") or _looks_like_mp3_frame(data):
            return "audio/mpeg"
        return None
    for signature, content_type in _IMAGE_SIGNATURES:
        if data.startswith(signature):
            return content_type
    return _sniff_webp(data)
