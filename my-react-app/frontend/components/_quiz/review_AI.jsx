import "../../static/css/_quiz/review_AI.css"
import { useRef, useState } from "react";
import { Send, Bot, X, Play } from "lucide-react";
import { TRIBE_NAME_BY_SLUG as TRIBE_NAME } from "../../src/constants/tribes";
import { apiPost } from "../../utils/apiClient";
import { useDialog } from "@hooks/useDialog";
import useAuthorizedAudioPlayback from "../../hooks/useAuthorizedAudioPlayback";
import ReviewSections from "./ReviewSections";
import { describeChatError } from "./botErrors";
import useChatRequest from "./chat/useChatRequest";
import ChatComposer from "./chat/ChatComposer";
import { ChatLog, TypingBubble } from "./chat/ChatLog";

// 一則句子補充說明：原句、參考翻譯、逐詞對照、分欄補充。
// interactive 只在放大的對話框裡開：縮圖那一則整塊是 role="button"，裡面不能再放按鈕與連結。
const ReviewNote = ({ msg, tribe, interactive, playAudio, failedAudio, large }) => {
    // 拒答或產生失敗時 translation 是固定說明，不是模型的翻譯，不標「參考翻譯」
    const isNotice = msg.refused || msg.failed;
    return (
        <div className={`translation-block${large ? " expanded" : ""}`}>
            <p className="original">{msg.original}</p>
            {isNotice ? (
                <p className="review-notice">{msg.translation}</p>
            ) : (
                <>
                    <p className="translation-label">參考翻譯（推測，未經族語專家確認）</p>
                    <p className="translation">{msg.translation}</p>
                </>
            )}
            <hr className="review-divider-AI" />
            <div className="word-line">
                {msg.words?.map((w, i) => {
                    const audioFailed = Boolean(w.audio) && failedAudio?.has(w.audio);
                    return (
                        <div key={i} className="word-block">
                            <span className="word">{w.word}</span>
                            <span className={`meaning ${w.color}`}>{w.meaning}</span>
                            {interactive && audioFailed && <span className="review-word-muted">音檔無法播放</span>}
                            {interactive && w.audio && !audioFailed && (
                                <button
                                    type="button"
                                    className="review-word-play"
                                    aria-label={`播放「${w.word}」的發音`}
                                    onClick={() => playAudio?.(w.audio)}
                                >
                                    <span className="review-word-play-icon"><Play size={14} aria-hidden="true" /></span>
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
            <ReviewSections sections={msg.sections} tribe={tribe} interactive={interactive} />
            {msg.image && (
                <img
                    decoding="async"
                    loading="lazy"
                    src={msg.image}
                    alt={msg.image_alt ?? "助手附上的圖片"}
                    className={`reply-image${large ? " large" : ""}`}
                />
            )}
        </div>
    );
};

// review.jsx 的 ReviewTabs 目前把這個分頁標成「即將推出」並擋掉導覽——
// 除了功能還沒做完，它現在也只收得到 tribe，收不到使用者選的是哪一題/
// 答對還是答錯，沒辦法真的「針對這一題」解說，等有明確的資料傳遞設計
// 後再開放。
const ReviewAIAssistant = ({ tribe = "tayal" }) => {
    const tribeName = TRIBE_NAME[tribe] || "族語";
    const [messages, setMessages] = useState([
        {
            id: 1,
            sender: "assistant",
            type: "intro",
            text: "哈囉！我是AI助手 👋 有什麼想問的嗎？",
        }
    ]);
    const [input, setInput] = useState("");
    const [expanded, setExpanded] = useState(null);
    const expandedRef = useRef(null);
    const lastTextRef = useRef("");
    const { playAudio, failedAudio } = useAuthorizedAudioPlayback();
    // 送出中的狀態機（防重複送出、卸載時中止請求）與懸浮聊天視窗共用
    const request = useChatRequest();
    const isType = request.isPending;

    // 放大訊息視窗：原本連 role 都沒有（審查項 P1-5）
    useDialog(expandedRef, { active: expanded !== null, onClose: () => setExpanded(null) });

    // retry：重送上一句。失敗的錯誤訊息會被拿掉，使用者的問題不重複顯示，輸入框裡正在打的新內容也不動（路線圖 #31）。
    const submit = async (text, { retry = false } = {}) => {
        // 等待回覆中不重複送出；按鈕與輸入框不用 disabled，避免焦點掉回 body（審查項 P1-6）
        if (!text.trim() || isType) return;
        const controller = request.begin();
        if (!controller) return;
        lastTextRef.current = text;

        if (retry) {
            // 只拿掉這次要重試的那則（最後一則），更早的失敗紀錄留著
            setMessages((prev) => (prev[prev.length - 1]?.retryable ? prev.slice(0, -1) : prev));
        } else {
            const userMsg = {
                id: Date.now(),
                sender: "user",
                type: "text",
                text,
            };
            setMessages((prev) => [...prev, userMsg]);
            setInput("");
        }

        try {
            const data = await apiPost(import.meta.env.VITE_API_REVIEW_BOT_URL, { message: text, tribe }, { signal: controller.signal });
            if (controller.signal.aborted) return;

            // 將資料轉成前端格式
            const aiReply = {
                id: Date.now() + 1,
                sender: "assistant",
                type: "translation",
                original: data.original,
                translation: data.translation,
                sections: data.sections && typeof data.sections === "object" ? data.sections : null,
                refused: data.refused === true,
                failed: data.failed === true,
                words: (Array.isArray(data.words) ? data.words : []).map((w, i) => ({
                    word: w.tayal,
                    meaning: w.chinese,
                    audio: w.audio || "",
                    color: `color${i + 1}`, // 可以依照索引上色
                })),
                image: data.image || null,
            };

            setMessages((prev) => [...prev, aiReply]);

        } catch (err) {
            if (controller.signal.aborted) return;
            console.error("錯誤:", err);
            const info = describeChatError(err);
            const errorMsg = {
                id: Date.now() + 2,
                sender: "assistant",
                type: "text",
                text: info.kind === "quota" ? "今天的提問次數已用完。" : info.text,
                retryable: info.retryable,
            };
            setMessages((prev) => [...prev, errorMsg]);
        } finally {
            request.finish();
        }
    };

    const handleSend = () => submit(input);
    const handleRetry = () => submit(lastTextRef.current, { retry: true });

    const renderMessage = (msg) => {
        const isUser = msg.sender === "user";
        return (
            <div
                key={msg.id}
                className={`chat-message ${isUser ? "user" : "assistant"}`}
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                onClick={() => setExpanded(msg)}
                onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setExpanded(msg);
                    }
                }}
            >
                <div className="avatar">
                    {isUser ? "" : <Bot size={24} />}
                </div>
                <div className="bubble">
                    {msg.type === "translation" ? (
                        <ReviewNote msg={msg} tribe={tribe} />
                    ) : (
                        <p>{msg.text}</p>
                    )}
                    {msg.retryable && msg.id === messages[messages.length - 1]?.id && !isType && (
                        <button
                            type="button"
                            className="review-retry"
                            // 訊息整塊可點開放大；重試鈕自己的點擊與按鍵不能冒泡成「放大」
                            onClick={(e) => { e.stopPropagation(); handleRetry(); }}
                            onKeyDown={(e) => e.stopPropagation()}
                        >
                            重試
                        </button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="assistant-layout">
            <div className="assistant-header">
                <h4><Bot size={20} />{tribeName}AI助手</h4>
            </div>

            <ChatLog className="assistant-messages">
                {messages.map(renderMessage)}
                {isType && (
                    <TypingBubble
                        rowClassName="message bot"
                        bubbleClassName="review-message-bubble typing"
                        indicatorClassName="review-typing-indicator"
                    />
                )}
            </ChatLog>

            <ChatComposer
                className="assistant-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onSubmit={handleSend}
                placeholder="輸入你的問題..."
                label="輸入問題"
                busy={isType}
            >
                <button type="button" onClick={handleSend} aria-label="傳送訊息" aria-disabled={!input.trim() || isType}><Send size={18} /></button>
            </ChatComposer>

            {/* 放大訊息 Modal */}
            {expanded && (
                <div className="modal-overlay" onClick={() => setExpanded(null)}>
                    <div
                        ref={expandedRef}
                        tabIndex={-1}
                        role="dialog"
                        aria-modal="true"
                        aria-label="放大檢視訊息"
                        className="modal-content"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button type="button" className="close-btn" onClick={() => setExpanded(null)} aria-label="關閉">
                            <X size={20} />
                        </button>
                        {expanded.type === "translation" ? (
                            <ReviewNote
                                msg={expanded}
                                tribe={tribe}
                                interactive
                                large
                                playAudio={playAudio}
                                failedAudio={failedAudio}
                            />
                        ) : (
                            <p className="expanded-text">{expanded.text}</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
export default ReviewAIAssistant;
