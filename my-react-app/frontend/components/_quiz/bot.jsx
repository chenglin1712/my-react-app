import "../../static/css/_quiz/bot.css"
import { useState, useRef, useEffect } from "react";
import { Bot, ChevronLeft } from "lucide-react"
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import StudyPlanComponent from "./bot_study_plan"
import { useAuth } from "../../src/userServives/authContext";
import { getUserSituation } from "../../src/userServives/uploadDb";
import { auth } from "../../../firebase";

const TRIBES = [
    { slug: "tayal", name: "泰雅" },
    { slug: "amis", name: "阿美" },
    { slug: "bunun", name: "布農" },
    { slug: "kavalan", name: "噶瑪蘭" },
    { slug: "paiwan", name: "排灣" },
];

const Advice = ({ onClose }) => {
    const navigate = useNavigate();
    const handleClose = onClose ?? (() => navigate(-1));
    const { userData } = useAuth();
    const [tribe, setTribe] = useState("tayal");
    const [messages, setMessages] = useState([
        { id: 1, text: "lokah su 你好！我是您的族語 AI 助手，有什麼我可以幫您的嗎？", role: "bot" }
    ]);
    const [input, setInput] = useState("");
    const [isType, setIsType] = useState(false);
    const messageEndRef = useRef(null);
    const [userStats, setUserStats] = useState({
        correct: 0, incorrect: 0, unanswered: 0, common_errors: [], level: "beginner"
    });

    // 在元件掛載後，從 Firebase 讀取使用者真實學習資料
    useEffect(() => {
        if (!userData) return;
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
                setUserStats({
                    correct: totalCorrect,
                    incorrect: totalErrors,
                    unanswered: 0,
                    common_errors: commonErrors,
                    level: sit?.level || "beginner",
                });
            })
            .catch(() => {
                setUserStats({
                    correct: totalCorrect,
                    incorrect: totalErrors,
                    unanswered: 0,
                    common_errors: commonErrors,
                    level: "beginner",
                });
            });
    }, [userData]);

    const suggestions = [
        "我想了解我的學習狀況",
        "介紹這個族語的文化特色",
        "幫我排一週讀書計畫"
    ];

    const handleInputChange = (e) => {
        setInput(e.target.value);
    };

    //傳送訊息
    const handleSend = async () => {
        if (input.trim() === "") return;

        const userText = input;
        const newUserMessage = { id: Date.now(), text: userText, role: "user" };
        setMessages(prev => [...prev, newUserMessage]);
        setInput("");
        setIsType(true);

        try {
            const token = await auth.currentUser?.getIdToken();
            const response = await fetch(import.meta.env.VITE_API_AI_BOT_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { "Authorization": `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ message: userText, user_stats: userStats, tribe }),
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            const botResponse = {
                id: Date.now() + 1,
                text: data.message,
                role: "bot",
                studyPlan: data.study_plan || null
            };

            setMessages(prev => [...prev, botResponse]);
        } catch (error) {
            const errorResponse = {
                id: Date.now() + 1,
                text: "很抱歉，無法取得回應，請稍後再試。",
                role: "bot"
            };
            setMessages(prev => [...prev, errorResponse]);
            console.error("取得回應失敗:", error);
        } finally {
            setIsType(false);
        }
    };

    const handleKeyPress = (e) => {
        if (e.key === "Enter") {
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
                initial={{ y: "100%", opacity: 0 }}
                animate={{ y: "0%", opacity: 1 }}
                exit={{ y: "100%", opacity: 0 }}
                transition={{ duration: 0.35 }}
            >
                <div className="chat-header">
                    <button
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
                    {isType && (
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
                            {suggestions.map((suggestion, index) => (
                                <button
                                    key={index}
                                    className="suggestion-pill"
                                    onClick={() => handleSuggestionClick(suggestion)}
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
                    />
                    <button
                        className={`send-button ${input.trim() ? 'active' : ''}`}
                        onClick={handleSend}
                        disabled={input.trim() === ""}
                    >
                        發送
                    </button>
                </div>
            </motion.div>
        </div >
    );
};
export default Advice;