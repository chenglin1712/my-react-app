"""LLM client 的單一來源——原本只有 backend/AIModel/views.py 自己持有（Django
的 tayal_chat／review_tayal_chat 兩個 AI 對話端點在用），族語翻譯功能
(backend/fastAPI/routes/translation/) 需要在 FastAPI process 裡呼叫同一個
LLM，於是把它搬到這個兩邊都能 import 的共用套件（比照 config/tribes.py／
config/firebase_auth.py 的既有模式)。

AIModel/views.py 保留同名的 _get_client()，內容改成呼叫這裡的
get_llm_client()，行為完全不變——這樣 AIModel/tests.py 既有的
`@patch("AIModel.views._get_client", ...)` 測試路徑不用跟著改。

2026-08：GitHub Models（原本代理 GPT-4o 的服務）已於 2026-07-30 正式關閉，
不是暫時性中斷，因此改接 Anthropic 官方 Claude API。實際發送請求的是官方
`anthropic` SDK（`anthropic.Anthropic(...).messages.create(...)`），
`_OpenAICompatClaudeClient` 這層只是把回傳值轉成呼叫端原本期待的
`client.chat.completions.create(...).choices[0].message.content` 形狀，
好讓 AIModel/services.py 與 translation/service.py 兩處呼叫端完全不用改
——並不是另外起一個 OpenAI 協定相容的服務端點。
"""
import os

import anthropic
from dotenv import load_dotenv

load_dotenv()

# Claude Sonnet 5——此專案的用途是短句翻譯／學生對話回覆，不需要 Opus 5 的
# 最強推理能力；Sonnet 5 品質已足夠，成本約為 Opus 5 的 4 折（經使用者確認）。
DEFAULT_MODEL = "claude-sonnet-5"

# 呼叫端目前的輸出都是短內容（50 字內中文說明、簡短讀書計畫 JSON、翻譯 JSON），
# 4096 tokens 留有餘裕又不至於放大意外重試的成本。
_MAX_TOKENS = 4096

_client = None


class _ShimMessage:
    __slots__ = ("content",)

    def __init__(self, content: str):
        self.content = content


class _ShimChoice:
    __slots__ = ("message",)

    def __init__(self, content: str):
        self.message = _ShimMessage(content)


class _ShimResponse:
    __slots__ = ("choices",)

    def __init__(self, content: str):
        self.choices = [_ShimChoice(content)]


class _ChatCompletions:
    def __init__(self, anthropic_client: "anthropic.Anthropic"):
        self._client = anthropic_client

    def create(self, *, model: str, messages: list, **_ignored):
        """把 OpenAI 形狀的呼叫（messages 含 role="system"、可能夾帶
        temperature 等取樣參數）轉成 Anthropic Messages API 的形狀。
        `_ignored` 吞掉 temperature 等參數——是否支援因模型而異，這裡一律
        不轉發，避免不同模型對取樣參數的支援差異變成呼叫端要煩惱的事。"""
        system = None
        claude_messages = []
        for m in messages:
            if m["role"] == "system":
                system = m["content"]
            else:
                claude_messages.append({"role": m["role"], "content": m["content"]})

        response = self._client.messages.create(
            model=model,
            max_tokens=_MAX_TOKENS,
            system=system,
            messages=claude_messages,
        )

        if response.stop_reason == "refusal":
            raise RuntimeError("[config.llm] Claude 拒絕回應此請求（refusal）")

        text = "".join(block.text for block in response.content if block.type == "text")
        return _ShimResponse(text)


class _ChatNamespace:
    def __init__(self, anthropic_client: "anthropic.Anthropic"):
        self.completions = _ChatCompletions(anthropic_client)


class _OpenAICompatClaudeClient:
    def __init__(self, anthropic_client: "anthropic.Anthropic"):
        self.chat = _ChatNamespace(anthropic_client)


def get_llm_client():
    """延遲初始化 Anthropic client，第一次真的呼叫 AI 功能時才檢查
    ANTHROPIC_API_KEY。

    這個函式會被兩個進入點 import：Django 的 core/urls.py 一定會 import 到
    AIModel.urls，FastAPI 的 main.py 一定會 import 到 translation 路由——兩邊
    都不該在「模組載入」當下就檢查金鑰，缺一把金鑰不該讓整個 process 啟動
    失敗、連跟 AI 功能無關的其他端點都連帶壞掉。延後到實際呼叫時才檢查，
    缺金鑰只會讓用到 AI 的端點回 503，其餘功能不受影響。"""
    global _client
    if _client is not None:
        return _client
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise EnvironmentError(
            "[config.llm] 環境變數 ANTHROPIC_API_KEY 未設定，AI 對話／翻譯功能無法使用。"
            "請在 .env 填入 Anthropic API key。"
        )
    _client = _OpenAICompatClaudeClient(anthropic.Anthropic(api_key=api_key))
    return _client
