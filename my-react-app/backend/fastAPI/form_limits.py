"""multipart 表單解析的上限（資安 S-04：Starlette 的表單解析 DoS）。

Starlette 預設最多接受 1000 個欄位、1000 個檔案，而且 FastAPI 用 `File(...)`／`Form(...)`
宣告參數時沒辦法調整這些數字。攻擊者可以送出大量小分段，讓解析階段就耗掉 CPU 與記憶體，
這時後面「檔案不得超過 N MB」的檢查根本還沒執行。

這兩個上傳端點（視覺辨識、發音比對）的前端只會送固定的幾個欄位，所以改成手動呼叫
`request.form(...)` 並明確設上限，超過時 Starlette 會直接回 400，不會繼續解析。

注意：
- 手動解析就不再有 FastAPI 自動關閉 UploadFile（暫存檔）的機制，呼叫端必須在 finally 裡
  `await form.close()`。
- max_files／max_fields 分開計數；max_part_size 只管文字欄位，管不到檔案本身。單一超大檔案的
  傳輸量由 nginx 的 client_max_body_size 擋；應用層用 `file.read(上限 + 1)` 判斷超限，
  不把整個檔案再載入 Python 記憶體一次。
"""
from fastapi import HTTPException, Request
from starlette.datastructures import FormData, UploadFile

# 非檔案欄位（audio_id、reference_urls 這類文字）單一欄位的位元組上限。
# Starlette 預設 1 MiB；reference_urls 最長也只是幾個 URL 接起來，64 KiB 綽綽有餘。
MAX_TEXT_FIELD_BYTES = 64 * 1024


async def parse_bounded_form(request: Request, *, max_files: int, max_fields: int) -> FormData:
    """解析 multipart 表單，並限制檔案數、文字欄位數與單一文字欄位大小。"""
    return await request.form(
        max_files=max_files,
        max_fields=max_fields,
        max_part_size=MAX_TEXT_FIELD_BYTES,
    )


def multipart_openapi_extra(*, file_field: str, required_text=(), optional_text=()) -> dict:
    """手動解析表單後，FastAPI 看不到請求內容的欄位，API 文件（/docs，只在 DEBUG 開）會少了
    request body。用 openapi_extra 把它補回去，讓文件與實際接受的欄位一致。"""
    properties = {file_field: {"type": "string", "format": "binary"}}
    for name in (*required_text, *optional_text):
        properties[name] = {"type": "string"}
    return {
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "properties": properties,
                        "required": [file_field, *required_text],
                    }
                }
            },
        }
    }


def is_upload(value) -> bool:
    """是不是 multipart 解析出來的檔案。用 Starlette 的 UploadFile（FastAPI 的是它的子類別，
    但解析器實際建立的是 Starlette 這個）。"""
    return isinstance(value, UploadFile)


def require_upload(form: FormData, name: str) -> UploadFile:
    """取出名為 name 的上傳檔案；缺少或不是檔案（例如被當成純文字欄位送）都回 422。"""
    value = form.get(name)
    if not is_upload(value):
        raise HTTPException(status_code=422, detail=f"缺少檔案欄位 {name}")
    return value


def require_text(form: FormData, name: str) -> str:
    """取出名為 name 的文字欄位；缺少或其實是檔案都回 422。"""
    value = form.get(name)
    if not isinstance(value, str):
        raise HTTPException(status_code=422, detail=f"缺少欄位 {name}")
    return value
