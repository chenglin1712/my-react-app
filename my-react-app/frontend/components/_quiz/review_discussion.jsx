import "../../static/css/_quiz/review_discussion.css"
import { useState } from "react";
import { UserCircle, Send, MessageCircle, ThumbsUp, CornerDownRight } from "lucide-react";

const Discussion = ({ }) => {
    const [messages, setMessages] = useState([
        {
            id: 1,
            user: "User",
            avatar: "https://res.cloudinary.com/ddtttpd2a/image/upload/v1755674145/%E4%BA%BA_w1qaav.png",
            text: "請問選項 B 的泰雅語是什麼？🤔",
            time: "2025-08-28",
            likes: 0,
            replies: [
                {
                    id: 11,
                    user: "王小明",
                    avatar: "https://res.cloudinary.com/ddtttpd2a/image/upload/v1754930051/%E7%8E%8B%E5%B0%8F%E6%98%8E_rtygjf.webp",
                    text: "跳舞的泰雅語是 m_yugi' 喔！",
                    time: "2025-08-28",
                    likes: 3
                }
            ]
        },
        {
            id: 2,
            user: "User",
            avatar: "https://res.cloudinary.com/ddtttpd2a/image/upload/v1755674145/%E4%BA%BA_w1qaav.png",
            text: "matas 畫圖🎨",
            time: "2025-08-30",
            likes: 1,
            replies: []
        }
    ]);
    const [input, setInput] = useState("");

    const handleSend = () => {
        if (!input.trim()) return;
        const newMessage = {
            id: Date.now(),
            user: "我",
            text: input,
            time: "剛剛",
            likes: 0,
            replies: []
        };
        setMessages([...messages, newMessage]);
        setInput("");
    };

    const handleLike = (id) => {
        setMessages(messages.map(msg =>
            msg.id === id ? { ...msg, likes: msg.likes + 1 } : msg
        ));
    };

    const renderAvatar = (avatar, size = 36) => {
        return avatar
            ? <img src={avatar} alt="avatar" className="avatar-img" style={{ width: size, height: size }} />
            : <UserCircle className="avatar" size={size} />;
    };

    return (
        <div className="discussion-layout">
            <div className="discussion-box">

                <div className="discussion-header">
                    <h4><MessageCircle size={20} />討論區</h4>
                </div>

                <div className="messages">
                    {messages.map((msg) => (
                        <div key={msg.id} className="message-card">
                            {renderAvatar(msg.avatar, 36)}
                            <div className="message-content">
                                <p className="user">{msg.user} <span className="time">{msg.time}</span></p>
                                <p className="text">{msg.text}</p>
                                <div className="actions">
                                    <button onClick={() => handleLike(msg.id)}>
                                        <ThumbsUp size={14} /> {msg.likes}
                                    </button>
                                    <button>
                                        <CornerDownRight size={14} /> 回覆
                                    </button>
                                </div>

                                {msg.replies && msg.replies.length > 0 && (
                                    <div className="replies">
                                        {msg.replies.map((reply) => (
                                            <div key={reply.id} className="reply-card">
                                                {renderAvatar(reply.avatar, 36)}
                                                <div className="message-content">
                                                    <p className="user">{reply.user} <span className="time">{reply.time}</span></p>
                                                    <p className="text">{reply.text}</p>
                                                    <div className="actions">
                                                        <button>
                                                            <ThumbsUp size={14} /> {reply.likes}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="input-box">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="輸入留言..."
                    />
                    <button onClick={handleSend}><Send size={18} /></button>
                </div>
            </div>
        </div>
    );
};
export default Discussion;