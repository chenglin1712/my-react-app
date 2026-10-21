import "../../static/css/_quiz/review_AI.css"
import { useRef, useState } from "react";
import { Send, Bot, X, Play } from "lucide-react";
import { TRIBE_NAME_BY_SLUG as TRIBE_NAME } from "../../src/constants/tribes";
import { apiPost } from "../../utils/apiClient";
import { useDialog } from "@hooks/useDialog";
import useAuthorizedAudioPlayback from "../../hooks/useAuthorizedAudioPlayback";
import { dictionaryHref } from "../../utils/dictionaryLink";

// 補充說明的四個分欄（路線圖 #11）。後端只會回有內容的欄位，這裡照順序顯示有的那幾個。
const SECTION_LABELS = [
    ["grammar", "語法"],
    ["culture", "文化背景"],
    ["pitfalls", "常見錯誤"],
];

// 一則句子補充說明：原句、參考翻譯、逐詞對照、分欄補充。
// interactive 只在放大的對話框裡開：縮圖那一則整塊是 role="button"，裡面不能再放按鈕與連結。
const ReviewNote = ({ msg, tribe, interactive, playAudio, failedAudio, large }) => {
    // 拒答或產生失敗時 translation 是固定說明，不是模型的翻譯，不標「參考翻譯」
    const isNotice = msg.refused || msg.failed;
    const vocab = msg.sections?.vocab;
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
            {(vocab?.length > 0 || SECTION_LABELS.some(([key]) => msg.sections?.[key])) && (
                <dl className="review-sections">
                    {vocab?.length > 0 && (
                        <div className="review-section">
                            <dt>詞彙用法</dt>
                            <dd>
                                <ul className="review-vocab">
                                    {vocab.map((item, i) => (
                                        <li key={i}>
                                            {interactive ? (
                                                <a
                                                    className="review-vocab-word"
                                                    href={dictionaryHref(item.word, tribe)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    aria-label={`在辭典查看「${item.word}」（另開新分頁）`}
                                                >
                                                    {item.word}
                                                </a>
                                            ) : (
                                                <strong className="review-vocab-word">{item.word}</strong>
                                            )}
                                            <span>{item.note}</span>
                                        </li>
                                    ))}
                                </ul>
                            </dd>
                        </div>
                    )}
                    {SECTION_LABELS.map(([key, label]) => msg.sections?.[key] && (
                        <div className="review-section" key={key}>
                            <dt>{label}</dt>
                            <dd>{msg.sections[key]}</dd>
                        </div>
                    ))}
                </dl>
            )}
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
    const [isType, setIsType] = useState(false);
    const [expanded, setExpanded] = useState(null);
    const expandedRef = useRef(null);
    const { playAudio, failedAudio } = useAuthorizedAudioPlayback();

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
                        <ReviewNote msg={msg} tribe={tribe} />
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
