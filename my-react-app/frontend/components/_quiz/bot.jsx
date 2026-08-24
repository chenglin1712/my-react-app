import "../../static/css/_quiz/bot.css"
import { useState, useRef, useEffect } from "react";
import { Bot, ChevronLeft } from "lucide-react"
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import StudyPlanComponent from "./bot_study_plan"
import { useAuth } from "../../src/userServives/authContext";
import { getUserSituation } from "../../src/userServives/uploadDb";
import { TRIBES } from "../../src/constants/tribes";
import { apiPost } from "../../utils/apiClient";

const SUGGESTIONS = [
    "我想了解我的學習狀況",
    "介紹這個族語的文化特色",
    "幫我排一週讀書計畫"
];

const AIAssistantOverlay = ({ onClose }) => {
    const navigate = useNavigate();
    // 直接從網址進到 /bot（沒有帶 onClose）時用 navigate(-1) 可能把使用者導到
    // 應用程式以外的頁面（例如瀏覽器歷史紀錄的上一頁是外部網站），改成固定
    // 導回測驗首頁，行為可預期。
    const handleClose = onClose ?? (() => navigate("/quiz"));
    const { userData } = useAuth();
    const [tribe, setTribe] = useState("tayal");
    const [messages, setMessages] = useState([
        { id: 1, text: "lokah su 你好！我是您的族語 AI 助手，有什麼我可以幫您的嗎？", role: "bot" }
    ]);
    const [input, setInput] = useState("");
    const [isPending, setIsPending] = useState(false);
    const messageEndRef = useRef(null);
    const mountedRef = useRef(true);
    const abortControllerRef = useRef(null);
    const [userStats, setUserStats] = useState({
        correct: 0, incorrect: 0, unanswered: 0, common_errors: [], level: "beginner"
    });

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            // 對話框關掉/元件卸載時，還在進行中的請求就不用等了——中止它，
            // 避免回應回來時對著已經卸載的元件呼叫 setMessages/setIsPending。
            abortControllerRef.current?.abort();
        };
    }, []);

    // 在元件掛載後，從 Firebase 讀取使用者真實學習資料
    useEffect(() => {
        if (!userData) return;
        let cancelled = false;
        const userErrors = userData?.firestoreData?.user_errors || {};
        const commonErrors = Object.entries(userErrors)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3)
            .map(([word, cnt]) => `${word}（答錯${cnt}次）`);
        const totalErrors = Object.values(userErrors).reduce((sum, n) => sum + n, 0);

        // 薦讀測驗（IRT）累積的 type_stats 內含每種題型的作答次數(n)與錯誤次數(e)，
        // 答對數 = 總作答次數 - 總錯誤次數，取代原本永遠是 0 的寫死值
        const typeStats = userData?.firestoreData?.quiz_model?.type_stats || {};
        const totalAttempts = Object.values(typeStats).reduce((sum, s) => sum + (s.n || 0), 0);
        const totalTypeErrors = Object.values(typeStats).reduce((sum, s) => sum + (s.e || 0), 0);
        const totalCorrect = Math.max(totalAttempts - totalTypeErrors, 0);

        getUserSituation()
            .then(sit => {
                if (cancelled) return;
                setUserStats({
                    correct: totalCorrect,
                    incorrect: totalErrors,
                    unanswered: 0,
                    common_errors: commonErrors,
                    level: sit?.level || "beginner",
                });
            })
            .catch(() => {
                if (cancelled) return;
                setUserStats({
                    correct: totalCorrect,
                    incorrect: totalErrors,
                    unanswered: 0,
                    common_errors: commonErrors,
                    level: "beginner",
                });
            });
        return () => { cancelled = true; };
    }, [userData]);

    // 新訊息或「輸入中」指示器出現/消失時自動捲到底部，messageEndRef 原本宣告了
    // 卻從沒呼叫 scrollIntoView，訊息一多使用者得自己手動往下滑。
    useEffect(() => {
        messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, isPending]);

    const handleInputChange = (e) => {
        setInput(e.target.value);
    };

    //傳送訊息
    const handleSend = async () => {
        if (input.trim() === "" || isPending) return;

        const userText = input;
        const newUserMessage = { id: crypto.randomUUID(), text: userText, role: "user" };
        setMessages(prev => [...prev, newUserMessage]);
        setInput("");
        setIsPending(true);

        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const data = await apiPost(
                import.meta.env.VITE_API_AI_BOT_URL,
                { message: userText, user_stats: userStats, tribe },
                { signal: controller.signal },
            );
            if (!mountedRef.current) return;

            const botResponse = {
                id: crypto.randomUUID(),
                text: data?.message || "很抱歉，沒有取得有效的回應。",
                role: "bot",
                studyPlan: data?.study_plan || null
            };

            setMessages(prev => [...prev, botResponse]);
        } catch (error) {
            // 手動中止（關閉對話框/卸載）不是真正的失敗，不用再顯示錯誤訊息，
            // 這時元件通常也已經卸載了。
            if (controller.signal.aborted) return;
            if (!mountedRef.current) return;

            const errorResponse = {
                id: crypto.randomUUID(),
                text: "很抱歉，無法取得回應，請稍後再試。",
                role: "bot"
            };
            setMessages(prev => [...prev, errorResponse]);
            console.error("取得回應失敗:", error);
        } finally {
            if (mountedRef.current) setIsPending(false);
        }
    };

    const handleKeyPress = (e) => {
        // 中文/日文注音等輸入法用 Enter 確認候選字時也會觸發 keydown 的
        // Enter，這裡沒有排除的話，選字確認會被誤判成「送出訊息」，把還在
        // 組字中的內容提前送出去。
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            handleSend();
        }
    };

    const handleSuggestionClick = (suggestion) => {
        setInput(suggestion);
    };

    return (
        <div className="overlay">
            <motion.div
                className="chat-container"
                role="dialog"
                aria-modal="true"
                aria-label="族語 AI 助手"
                initial={{ y: "100%", opacity: 0 }}
                animate={{ y: "0%", opacity: 1 }}
                exit={{ y: "100%", opacity: 0 }}
                transition={{ duration: 0.35 }}
            >
                <div className="chat-header">
                    <button
                        type="button"
                        onClick={handleClose}
                        className="chat-return"
                        aria-label="返回"
                    >
                        <ChevronLeft size={22} />
                    </button>
                    <div className="avatar">
                        <Bot />
                    </div>
                    <div className="header-info">
                        <h2>{TRIBES.find((t) => t.slug === tribe)?.name}智慧助手</h2>
                        <p className="status online">在線</p>
                    </div>
                    <select
                        value={tribe}
                        onChange={(e) => setTribe(e.target.value)}
                        disabled={isPending}
                        style={{ position: "relative", zIndex: 1, borderRadius: 6, border: "none", padding: "4px 6px" }}
                        aria-label="選擇族語"
                    >
                        {TRIBES.map((t) => (
                            <option key={t.slug} value={t.slug}>{t.name}語</option>
                        ))}
                    </select>
                </div>

                <div className="messages-container">
                    {messages.map((message) => (
                        <div key={message.id} className={`message ${message.role}`}>
                            {message.role === "bot" && (
                                <div className="avatar-small">
                                    <Bot />
                                </div>
                            )}
                            <div className="message-bubble">
                                <p>{message.text}</p>
                                {message.studyPlan && (
                                    <StudyPlanComponent plan={message.studyPlan} onClose={handleClose} />
                                )}
                            </div>
                        </div>
                    ))}
                    {isPending && (
                        <div className="message bot">
                            <div className="avatar-small">
                                <Bot />
                            </div>
                            <div className="message-bubble typing">
                                <div className="typing-indicator">
                                    <span></span>
                                    <span></span>
                                    <span></span>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messageEndRef} />
                </div>

                {messages.length <= 2 && (
                    <div className="suggestions-container">
                        <p className="suggestions-title">您可能想問：</p>
                        <div className="suggestion-pills">
                            {SUGGESTIONS.map((suggestion, index) => (
                                <button
                                    type="button"
                                    key={index}
                                    className="suggestion-pill"
                                    onClick={() => handleSuggestionClick(suggestion)}
                                    disabled={isPending}
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="input-area">
                    <input
                        type="text"
                        value={input}
                        onChange={handleInputChange}
                        onKeyPress={handleKeyPress}
                        placeholder="輸入您的訊息..."
                        className="message-input"
                        aria-label="輸入訊息"
                        disabled={isPending}
                    />
                    <button
                        type="button"
                        className={`send-button ${input.trim() ? 'active' : ''}`}
                        onClick={handleSend}
                        disabled={input.trim() === "" || isPending}
                    >
                        發送
                    </button>
                </div>
            </motion.div>
        </div >
    );
};
export default AIAssistantOverlay;
