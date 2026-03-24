import "../../static/css/_quiz/bot.css"
import { useState, useRef } from "react";
import { Bot, ChevronLeft } from "lucide-react"
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import StudyPlanComponent from "./bot_study_plan"

const Advice = ({ onClose }) => {
    const navigate = useNavigate();
    const handleClose = onClose ?? (() => navigate(-1));
    const [messages, setMessages] = useState([
        { id: 1, text: "lokah su 你好！我是您的泰雅AI助手，有什麼我可以幫您的嗎？", role: "bot" }
    ]);
    const [input, setInput] = useState("");
    const [isType, setIsType] = useState(false);
    const messageEndRef = useRef(null);

    const suggestions = [
        "我想了解我的學習狀況",
        "介紹泰雅族的編織藝術",
        "幫我排一週讀書計畫"
    ];

    const handleInputChange = (e) => {
        setInput(e.target.value);
    };

    //傳送訊息
    const handleSend = async () => {
        if (input.trim() === "") return;

        const newUserMessage = { id: messages.length + 1, text: input, role: "user" };
        setMessages([...messages, newUserMessage]);
        setInput("");
        setIsType(true);

        try {
            const response = await fetch(import.meta.env.VITE_API_AI_BOT_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ message: input })
            });

            const data = await response.json();

            const botResponse = {
                id: messages.length + 2,
                text: data.message,
                role: "bot",
                studyPlan: data.study_plan || null
            };

            setMessages(prev => [...prev, botResponse]);
        } catch (error) {
            const errorResponse = {
                id: messages.length + 2,
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
                    >
                        <ChevronLeft size={22} />
                    </button>
                    <div className="avatar">
                        <Bot />
                    </div>
                    <div className="header-info">
                        <h2>泰雅智慧助手</h2>
                        <p className="status online">在線</p>
                    </div>
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