"""提示詞版本（路線圖 #29、#30、#35）：由目前所有固定提示詞的內容算出的短雜湊。

改了任何一段固定提示詞，版本就會變；評測報告與使用者回饋都記下它，之後才能回答
「這個倒讚／這次分數退步，是改了哪一版提示詞之後發生的」。只看固定段落（不含學生資料、日期、族語名稱這些
每次都不同的值），所以同一版提示詞在任何時間、任何人身上算出來都一樣。

管理者在後台設定的補充風格指示與離題處理（assistant_settings）也算進去：後台儲存或回滾之後版本會跟著變，
每筆用量紀錄與回饋都能對回當時的設定。
"""
import hashlib

_memo: dict = {}


def prompt_version() -> str:
    from . import assistant_settings, services

    settings = assistant_settings.active()
    parts = [
        services._chat_static_prompt(True, False, False),
        services._chat_static_prompt(True, True, True),
        services._plan_static_prompt(),
        services.build_chitchat_system(""),
        services.build_chitchat_system("", gentle=True),
        services.build_review_prompt("", ""),
        settings["offtopic_policy"],
        settings["off_topic_message"],
    ]
    key = "\n␞\n".join(parts)
    if key not in _memo:
        if len(_memo) > 32:           # 後台草稿試跑會產生各式各樣的版本：不要讓快取無限長大
            _memo.clear()
        _memo[key] = hashlib.sha256(key.encode("utf-8")).hexdigest()[:8]
    return _memo[key]
