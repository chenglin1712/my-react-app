"""提示詞版本（路線圖 #29、#30）：由目前所有固定提示詞的內容算出的短雜湊。

改了任何一段固定提示詞，版本就會變；評測報告與使用者回饋都記下它，之後才能回答
「這個倒讚／這次分數退步，是改了哪一版提示詞之後發生的」。只看固定段落（不含學生資料、日期、族語名稱這些
每次都不同的值），所以同一版提示詞在任何時間、任何人身上算出來都一樣。
"""
import hashlib
from functools import lru_cache


@lru_cache(maxsize=1)
def prompt_version() -> str:
    from . import services

    parts = [
        services._chat_static_prompt(True, False, False),
        services._chat_static_prompt(True, True, True),
        services._plan_static_prompt(),
        services.build_chitchat_system(""),
        services.build_review_prompt("", ""),
    ]
    digest = hashlib.sha256("\n␞\n".join(parts).encode("utf-8")).hexdigest()
    return digest[:8]
