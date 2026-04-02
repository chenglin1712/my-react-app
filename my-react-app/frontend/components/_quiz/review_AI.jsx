import "../../static/css/_quiz/review_AI.css"
import { useState, useEffect } from "react";
import { UserCircle, Send, Bot, X } from "lucide-react";

const Discussion = () => {
    const [messages, setMessages] = useState([
        {
            id: 1,
            sender: "assistant",
            type: "intro",
            text: "哈囉！我是泰雅助手 👋 有什麼想問的嗎？",
        }
    ]);
    const [input, setInput] = useState("");
    const [isType, setIsType] = useState(false);
    const [expanded, setExpanded] = useState(null);

    const handleSend = async () => {
        if (!input.trim()) return;

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
            const res = await fetch(import.meta.env.VITE_API_REVIEW_BOT_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ message: input }),
            });

            if (!res.ok) {
                throw new Error("API 請求失敗");
            }

            const data = await res.json();

            // 將資料轉成前端格式
            const aiReply = {
                id: Date.now() + 1,
                sender: "assistant",
                type: "translation",
                original: data.original,
                translation: data.translation,
                words: data.words.map((w, i) => ({
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
                onClick={() => setExpanded(msg)}
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
                            {msg.image && <img src={msg.image} alt="相關圖示" className="reply-image" />}
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
                <h4><Bot size={20} />泰雅助手</h4>
            </div>

            <div className="assistant-messages">
                {messages.map(renderMessage)}
                {isType && (
                    <div className="message bot">
                        <div className="avatar-small">
                            <Bot />
                        </div>
                        <div className="review-message-bubble typing">
                            <div className="review-typing-indicator">
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
                    placeholder="輸入你的問題..."
                />
                <button onClick={handleSend}><Send size={18} /></button>
            </div>

            {/* 放大訊息 Modal */}
            {expanded && (
                <div className="modal-overlay" onClick={() => setExpanded(null)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <button className="close-btn" onClick={() => setExpanded(null)}>
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
                                {expanded.image && <img src={expanded.image} alt="圖示" className="reply-image large" />}
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
export default Discussion;