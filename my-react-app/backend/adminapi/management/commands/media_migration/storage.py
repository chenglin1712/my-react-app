"""上傳到 Firebase Storage 之後的驗證邏輯。實際上傳呼叫
（adminapi.firebase_ops.upload_media_object）由 runner.py 直接呼叫，這裡
只放上傳之後「這個網址真的公開可讀、大小也對」的驗證，避免只信任
upload_from_string() 沒丟例外就代表沒問題。"""
import httpx

from .fetcher import _CONNECT_TIMEOUT

_VERIFY_TIMEOUT = 15.0


async def _verify_public_read(client, public_url, expected_size):
    """上傳後立刻用一次匿名 HEAD 請求驗證「這個網址真的公開可讀、大小也對」，
    不是只信任 upload_from_string() 沒丟例外就代表沒問題。這一步是唯一能
    真正抓到「Firebase bucket 其實沒開公開讀取權限，物件其實傳上去了但一般
    使用者連不到（403）」這種上傳 API 呼叫成功、實際卻壞掉的情況——不驗證
    的話，這種問題會被靜默標成 verified，一直到真人在網站上點才會發現。

    只驗證可公開讀取＋大小相符，不是逐 byte 內容 hash 比對（那需要重新
    GET 整份內容，對 4.8 萬個檔案的例行遷移來說成本太高）；真正的內容
    正確性驗證放在 pilot 階段人工抽樣做（見 plan 的「驗證」章節）。"""
    try:
        res = await client.head(
            public_url,
            timeout=httpx.Timeout(connect=_CONNECT_TIMEOUT, read=_VERIFY_TIMEOUT, write=_VERIFY_TIMEOUT, pool=_VERIFY_TIMEOUT),
        )
    except httpx.HTTPError as exc:
        raise RuntimeError(f"驗證公開讀取時發生錯誤：{exc}")
    if res.status_code != 200:
        raise RuntimeError(f"公開讀取驗證失敗：HTTP {res.status_code}（bucket 可能沒有設定公開讀取）")
    # Google Cloud Storage 的公開物件正常一定會回 Content-Length，缺少或無法
    # 解析視為驗證失敗（fail closed），不是略過不檢查——這裡就是在防「上傳
    # 有回應、但實際內容跟預期對不上」的情況，缺這個 header 反而更可疑。
    content_length = res.headers.get("content-length")
    if content_length is None:
        raise RuntimeError("公開讀取驗證失敗：回應沒有 Content-Length，無法確認內容大小")
    try:
        actual_size = int(content_length)
    except ValueError:
        raise RuntimeError(f"公開讀取驗證失敗：Content-Length 無法解析（{content_length!r}）")
    if actual_size != expected_size:
        raise RuntimeError(f"公開讀取驗證大小不符：預期 {expected_size} bytes，實際 {actual_size} bytes")
