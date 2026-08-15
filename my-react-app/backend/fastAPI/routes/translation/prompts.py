"""族語翻譯功能的 prompt 組裝——純函式，只吃資料、回傳字串，不碰 HTTP/LLM。
比照 backend/AIModel/services.py 的 build_chat_prompt／build_review_prompt
風格：組 prompt 這件事跟「怎麼呼叫模型」完全無關，獨立出來才能單獨測試、
之後要 A/B 測 prompt 也不用碰到呼叫端。

**這五族語 GPT-4o 幾乎沒有可靠的內建知識**（沒有任何 fine-tune，模型本身
對這五個語言的訓練資料量趨近於零），所以中文 -> 族語方向的 prompt 核心
設計是把它「釘住」在檢索到的證據上：只能用列出來的詞彙/例句，不能自由發揮。
族語 -> 中文方向風險小得多（目標語是模型很強的中文），接地的重點在來源側
的逐詞對照要正確帶到，模型不需要對族語有理解能力，只要照抄詞義組句。

tribe_name 一律用實際請求的族語全名代入（泰雅語／阿美語／布農語／噶瑪蘭語／
排灣語），五族共用同一套函式，不能有任何寫死單一族語的字串。
"""
from __future__ import annotations

from .retrieve import MatchedSpan, SentenceMatch, WordMatch


def _format_sentence_evidence(sentences: list[SentenceMatch]) -> str:
    lines = []
    for i, s in enumerate(sentences, start=1):
        lines.append(f"[S{i}] {s.original} ／ {s.chinese}")
    return "\n".join(lines) if lines else "（無）"


def _format_word_evidence(words: list[WordMatch]) -> str:
    lines = []
    for i, w in enumerate(words, start=1):
        gloss = w.gloss or "（無釋義）"
        lines.append(f"[W{i}] {w.name} ＝ {gloss}")
    return "\n".join(lines) if lines else "（無）"


def build_zh2tribe_prompt(tribe_name: str, source_text: str,
                           sentences: list[SentenceMatch], words: list[WordMatch]) -> str:
    """繁體中文 -> 族語。核心接地規則放最前面且重複強調：只能用下面列出的
    詞彙／例句，查無資料時寧可保守也不能自創拼寫。"""
    sentence_evidence = _format_sentence_evidence(sentences)
    word_evidence = _format_word_evidence(words)
    has_evidence = bool(sentences or words)

    evidence_warning = (
        "" if has_evidence else
        "\n**注意：下方沒有檢索到任何相關的辭典例句或詞彙。這種情況下你幾乎不可能"
        "正確產生這個語言的內容，請只用最基本、最有把握的詞彙（如果完全沒有把握，"
        "寧可保留原文中文字詞不翻譯）——絕對不要為了填滿句子而編造拼寫。**\n"
    )

    return f"""你是一位{tribe_name}翻譯助手，任務是把使用者輸入的繁體中文句子翻譯成{tribe_name}。

你只能使用下方「可用詞彙」與「對照例句」中出現過的{tribe_name}拼寫。**嚴禁**輸出任何未在下方資料中出現的{tribe_name}詞形；你對這個語言的既有印象不可靠，一律以下方資料為準。
若「對照例句」中有語意幾乎相同的句子，直接採用該句的原文，不要改寫。
若資料不足以完整表達，寧可輸出較短、較保守的句子，也不要自行造詞。
{evidence_warning}
對照例句（{tribe_name} ／ 中文）：
{sentence_evidence}

可用詞彙（{tribe_name} ＝ 中文釋義）：
{word_evidence}

要翻譯的中文句子：
{source_text}

只輸出 JSON，不要有任何其他文字或 ``` 標記：
{{"translation":"（{tribe_name}譯文）","usedEvidence":["S1","W3"],"uncertainTokens":["（你自己覺得沒把握的詞，沒有就空陣列）"],"note":"（30字內的繁中補充說明，例如翻譯策略或省略了什麼）"}}"""


def _format_token_gloss(tokens: list[MatchedSpan]) -> str:
    """punct（標點）不列進逐詞對照——那不是需要模型理解語意的詞，列出來
    只會干擾 prompt。headword/attested/derived 三層都算「查得到」，直接
    顯示 gloss；derived 沒有 gloss（詞綴剝除後只找到 attested 例句、沒有
    對應詞條）時顯示剝除說明，讓模型至少知道這是某個詞的變化形。"""
    lines = []
    for t in tokens:
        if t.status == "punct":
            continue
        if t.gloss:
            lines.append(f"{t.surface} ＝ {t.gloss}")
        elif t.status != "unsupported":
            lines.append(f"{t.surface} ＝（{t.note or '辭典有相關例句，但無單獨釋義'}）")
        else:
            lines.append(f"{t.surface} ＝ 〔辭典查無此詞〕")
    return "\n".join(lines) if lines else "（無）"


def build_tribe2zh_prompt(tribe_name: str, source_text: str,
                           tokens: list[MatchedSpan], sentences: list[SentenceMatch]) -> str:
    """族語 -> 繁體中文。風險比反方向小很多：目標語是中文，模型本身就強，
    接地的重點在提供正確的逐詞對照，不需要靠模型自己認識這個語言。"""
    token_gloss = _format_token_gloss(tokens)
    sentence_evidence = _format_sentence_evidence(sentences)

    return f"""你是一位{tribe_name}翻譯助手，任務是把使用者輸入的{tribe_name}句子翻譯成繁體中文。

下方是這句話逐詞對照辭典查到的中文釋義（依原句順序排列），以及語意相近的辭典例句可以參考：

逐詞對照：
{token_gloss}

相近例句（{tribe_name} ／ 中文）：
{sentence_evidence}

要翻譯的{tribe_name}句子：
{source_text}

請根據逐詞對照組成通順的繁體中文句子。查無釋義的詞（標示「辭典查無此詞」的）用〔?〕標出對應位置，不要猜測其意義。

只輸出 JSON，不要有任何其他文字或 ``` 標記：
{{"translation":"（繁體中文譯文，查無釋義處用〔?〕標示）","unknownTokens":["（辭典查無釋義的原詞，沒有就空陣列）"],"note":"（30字內的繁中補充說明）"}}"""
