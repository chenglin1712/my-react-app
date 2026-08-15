"""AI 對話功能的 prompt 組裝與 LLM 呼叫，從 views.py 的 HTTP handler 抽出來。

原本 tayal_chat／review_tayal_chat 這兩個 view 把身份驗證、限流、序列化驗證、
prompt 樣板、外部 API 呼叫、回應解析全部塞在同一個函式裡，要 A/B 測試 prompt
或在批次任務裡重用這段邏輯，得從 HTTP handler 裡把它挖出來。這裡把「組 prompt
→ 呼叫 LLM → 解析回應」這段跟 HTTP 完全無關的邏輯獨立出來：這兩個函式只吃
純資料（tribe_name／user_message／...）、回傳純 dict，不觸碰 request/response、
不知道 Django 的存在，views.py 的兩個 view 只負責認證/限流/驗證/例外轉 HTTP。

沿用檔案裡原本就有的拆分風格（_query_word_dicts／_words_to_dicts 把 DB 查詢
跟組裝分開），這裡是同一種思路用在 AI 呼叫上。
"""
import datetime
import json

from config.llm import DEFAULT_MODEL


def build_chat_prompt(tribe_name: str, level, correct, incorrect, unanswered, common_errors, today, tomorrow) -> str:
    """tayal_chat 用的 system prompt：一般對話／學習狀況分析（預設）
    或制定讀書計畫（使用者明確要求時，改回傳 JSON）兩種模式。"""
    return f"""
            你是一位{tribe_name}老師。你有兩種回應模式：
            ### 模式一：一般對話與學習狀況分析 (預設)
            當使用者進行一般對話，或詢問 "想了解學習狀況" 時：
            1.  根據以下使用者資料，用對話方式進行正向引導（正向，100字內，不用Markdown或換行符號）。
            2.  資料：
                - 程度: {level}
                - 答對: {correct}
                - 答錯: {incorrect}
                - 未作答: {unanswered}
                - 常見錯誤: {common_errors}
            3.  範例回應: "lokah su! 你的學習狀況不錯，答對了...題。要注意...的拼寫喔。"

            ### 模式二：制定讀書計畫 (JSON 輸出)
            當使用者要求 "制定讀書計畫" (例如：幫我排一個一週讀書計畫、規劃學習)：
            1.  你 **必須** 根據使用者的程度 ({level}) 來設計一個合適的計畫。
            2.  忽略100字限制，並 **回傳一個有效的 JSON 物件**，不要有任何 JSON 以外的文字 (例如 "好的，這是您的計畫..." 或 ```json ... ``` 標籤)。
            3.  計畫應從明天 ({tomorrow}) 開始。所有時間都應使用 'Asia/Taipei' (+08:00) 時區。
            4.  JSON 格式必須如下 (這是前端需要的格式)：
            {{
                "type":"study_plan",
                "title": "（計畫標題，例如：{tribe_name}一週讀書計畫）",
                "events": [
                    {{
                    "summary": "（第一天的學習任務）",
                    "description": "（任務的詳細描述，例如：前往 '初級測驗' 練習基礎詞彙）",
                    "start": "{tomorrow}T10:00:00+08:00",
                    "end": "{tomorrow}T10:30:00+08:00"
                    }},
                    {{
                    "summary": "（第二天的學習任務）",
                    "description": "（任務的詳細描述）",
                    "start": "{(today + datetime.timedelta(days=2)).isoformat()}T14:00:00+08:00",
                    "end": "{(today + datetime.timedelta(days=2)).isoformat()}T14:30:00+08:00"
                    }}
                ]
            }}

            ---
            使用者的程度是： {level}
            今天的日期是：{today.isoformat()}
            """


def _extract_study_plan(result: str):
    """result 是模式二（JSON 讀書計畫）時，解析並驗證出前端需要的欄位都齊全才
    當成有效計畫；缺漏或格式不對就回傳 None，呼叫端會改走純文字訊息 fallback，
    避免前端卡在半殘的 JSON 資料上噴錯。"""
    if not result.strip().startswith("{"):
        return None
    try:
        parsed = json.loads(result)
    except json.JSONDecodeError:
        return None

    if (
        isinstance(parsed, dict)
        and parsed.get('type') == 'study_plan'
        and isinstance(parsed.get('events'), list)
        and len(parsed['events']) > 0
        and all(
            isinstance(ev, dict) and ev.get('summary') and ev.get('start') and ev.get('end')
            for ev in parsed['events']
        )
    ):
        return parsed
    return None


def run_tayal_chat(client, tribe_name: str, user_message: str, user_stats: dict) -> dict:
    """組 prompt、呼叫 LLM、解析回應，回傳可以直接塞進 JsonResponse 的 dict。
    例外不在這裡處理，交給呼叫端（view）決定要記什麼 log、回什麼 HTTP 狀態碼。"""
    level = user_stats.get("level", "beginner")
    correct = user_stats.get("correct", 0)
    incorrect = user_stats.get("incorrect", 0)
    unanswered = user_stats.get("unanswered", 0)
    common_errors = user_stats.get("common_errors", [])

    today = datetime.date.today()
    tomorrow = (today + datetime.timedelta(days=1)).isoformat()
    prompt = build_chat_prompt(tribe_name, level, correct, incorrect, unanswered, common_errors, today, tomorrow)

    response = client.chat.completions.create(
        model=DEFAULT_MODEL,
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_message}
        ]
    )
    result = response.choices[0].message.content or ""

    plan_data = _extract_study_plan(result)
    if plan_data:
        # 前端聊天泡泡固定顯示 data.message，讀書計畫這裡原本沒有帶這個欄位，
        # 會顯示空白泡泡，補上一句簡短確認訊息。
        return {
            "message": f"已經為你排好「{plan_data.get('title') or '讀書計畫'}」，點選下方卡片即可加入行事曆。",
            "study_plan": plan_data,
        }

    return {"message": result}


def build_review_prompt(tribe_name: str, words_context: str) -> str:
    """review_tayal_chat 用的 system prompt：使用者已有句子完整翻譯，
    只需要額外的詞彙用法／語法／文化背景補充說明。"""
    return f"""
                你是一位{tribe_name}老師，幫助學生理解句子。
                使用者已經有句子的完整中文翻譯，你的任務不是重複翻譯，而是提供額外的補充說明，例如：
                - 詞彙用法
                - 語法結構
                - 文化背景或上下文提示
                - 注意事項或常見錯誤

                詞彙庫：
                {words_context}

                要求：
                1. 產生一句完整的中文翻譯
                2. 保持正向、簡潔的教學語氣
                3. 不要使用 Markdown 標記（例如 **）
                4. 每個詞可以簡單說明用法或文化背景
                5. 字數控制在50字內

            """


def run_review_tayal_chat(client, tribe_name: str, user_message: str, relevant_words: list) -> dict:
    """組 prompt、呼叫 LLM，回傳可以直接塞進 JsonResponse 的 dict。relevant_words
    由呼叫端先用既有的 search_tayal_words_bulk 查好（DB 查詢邏輯不搬進這裡，
    這裡只負責拿現成的詞彙資料組 prompt）。"""
    words_context = f"**{tribe_name}詞彙庫參考資料：**\n"
    for w in relevant_words:
        words_context += f"- {w['tayal']} : {w['chinese']}\n"

    prompt = build_review_prompt(tribe_name, words_context)

    response = client.chat.completions.create(
        model=DEFAULT_MODEL,
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_message}
        ]
    )
    ai_text = response.choices[0].message.content

    return {
        "original": user_message,
        "words": relevant_words,
        "translation": ai_text,
        "image": None,  # 之後可以依詞彙加圖
    }
