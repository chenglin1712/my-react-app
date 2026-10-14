import "../../static/css/_quiz/review_AI.css"
import { useRef, useState } from "react";
import { Send, Bot, X } from "lucide-react";
import { TRIBE_NAME_BY_SLUG as TRIBE_NAME } from "../../src/constants/tribes";
import { apiPost } from "../../utils/apiClient";
import { useDialog } from "@hooks/useDialog";

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
    const [isType, setIsType] = useState(false);
    const [expanded, setExpanded] = useState(null);
    const expandedRef = useRef(null);

    // 放大訊息視窗：原本連 role 都沒有（審查項 P1-5）
    useDialog(expandedRef, { active: expanded !== null, onClose: () => setExpanded(null) });

    const handleSend = async () => {
        // 等待回覆中不重複送出；按鈕與輸入框不用 disabled，避免焦點掉回 body（審查項 P1-6）
        if (!input.trim() || isType) return;

        const userMsg = {
            id: Date.now(),
            sender: "user",
            type: "text",
            text: input,
        };

        setMessages((prev) => [...prev, userMsg]);
        setInput("");
        setIsType(true);

        try {
            const data = await apiPost(import.meta.env.VITE_API_REVIEW_BOT_URL, { message: input, tribe });

            // 將資料轉成前端格式
            const aiReply = {
                id: Date.now() + 1,
                sender: "assistant",
                type: "translation",
                original: data.original,
                translation: data.translation,
                words: (Array.isArray(data.words) ? data.words : []).map((w, i) => ({
                    word: w.tayal,
                    meaning: w.chinese,
                    color: `color${i + 1}`, // 可以依照索引上色
                })),
                image: data.image || null,
            };

            setMessages((prev) => [...prev, aiReply]);

        } catch (err) {
            console.error("錯誤:", err);
            const errorMsg = {
                id: Date.now() + 2,
                sender: "assistant",
                type: "text",
                text: "伺服器錯誤，請稍後再試。",
            };
            setMessages((prev) => [...prev, errorMsg]);
        } finally {
            setIsType(false);
        }
    };

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
                        <div className="translation-block">
                            <p className="original">{msg.original}</p>
                            <p className="translation">{msg.translation}</p>
                            <hr className="review-divider-AI" />
                            <div className="word-line">
                                {msg.words?.map((w, i) => (
                                    <div key={i} className="word-block">
                                        <span className="word">{w.word}</span>
                                        <span className={`meaning ${w.color}`}>{w.meaning}</span>
                                    </div>
                                ))}
                            </div>
                            {msg.image && <img decoding="async" src={msg.image} alt={msg.image_alt ?? "助手附上的圖片"} className="reply-image" loading="lazy" />}
                        </div>
                    ) : (
                        <p>{msg.text}</p>
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

            <div className="assistant-messages" role="log" aria-live="polite" aria-relevant="additions" aria-label="對話紀錄">
                {messages.map(renderMessage)}
                {isType && (
                    <div className="message bot">
                        <div className="avatar-small">
                            <Bot />
                        </div>
                        <div className="review-message-bubble typing">
                            <span className="visually-hidden">助手正在輸入</span>
                            <div className="review-typing-indicator" aria-hidden="true">
                                <span></span>
                                <span></span>
                                <span></span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="assistant-input">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        // 組字中（注音、拼音）的 Enter 是選字，不是送出
                        if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) handleSend();
                    }}
                    placeholder="輸入你的問題..."
                    aria-label="輸入問題"
                    aria-busy={isType}
                />
                <button type="button" onClick={handleSend} aria-label="傳送訊息" aria-disabled={!input.trim() || isType}><Send size={18} /></button>
            </div>

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
                            <div className="translation-block expanded">
                                <p className="original">{expanded.original}</p>
                                <p className="translation">{expanded.translation}</p>
                                <hr className="review-divider-AI" />
                                <div className="word-line">
                                    {expanded.words?.map((w, i) => (
                                        <div key={i} className="word-block">
                                            <span className="word">{w.word}</span>
                                            <span className={`meaning ${w.color}`}>{w.meaning}</span>
                                        </div>
                                    ))}
                                </div>
                                {expanded.image && <img decoding="async" loading="lazy" src={expanded.image} alt={expanded.image_alt ?? "助手附上的圖片"} className="reply-image large" />}
                            </div>
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