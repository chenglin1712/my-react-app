"""專用且有上限的執行緒池（稽核 BE4-03）。

原本爬蟲、翻譯（LLM）、發音比對（wav2vec2）都用 asyncio.to_thread／run_in_executor(None) 丟到同一個預設執行緒池，
而 Firebase 驗證（auth.py）也在這個池子裡。單一 worker 時，一個使用者同時送出幾個慢請求（爬蟲逾時、
LLM 25 秒、長音檔推論）就能把池子佔滿，讓全部需要登入的端點排隊。這裡讓三類慢工作各自有上限，
驗證 token 與一般 DB 查詢仍留在預設池，不會被它們拖住。

池子大小可用環境變數調整：FASTAPI_CRAWLER_THREADS、FASTAPI_LLM_THREADS、FASTAPI_INFERENCE_THREADS。
"""
import asyncio
import contextvars
import functools
import os
from concurrent.futures import ThreadPoolExecutor


def _size(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, default)))
    except ValueError:
        return default


crawler_executor = ThreadPoolExecutor(max_workers=_size("FASTAPI_CRAWLER_THREADS", 4), thread_name_prefix="crawler")
llm_executor = ThreadPoolExecutor(max_workers=_size("FASTAPI_LLM_THREADS", 4), thread_name_prefix="llm")
# wav2vec2 推論是 CPU／記憶體密集：同時跑太多只會互相拖慢甚至 OOM，所以預設很小
inference_executor = ThreadPoolExecutor(max_workers=_size("FASTAPI_INFERENCE_THREADS", 2), thread_name_prefix="inference")


async def run_in(executor: ThreadPoolExecutor, func, /, *args, **kwargs):
    """在指定的執行緒池執行同步函式。跟 asyncio.to_thread 一樣會複製 contextvars
    （翻譯的 llm_current_uid 要靠它帶進工作執行緒），差別只在於用哪個池子。"""
    loop = asyncio.get_running_loop()
    context = contextvars.copy_context()
    return await loop.run_in_executor(executor, functools.partial(context.run, func, *args, **kwargs))
