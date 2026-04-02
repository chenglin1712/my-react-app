import "../../static/css/navigation/userSidebar.css"
import AvatarImg from "../../static/assets/_auth/avatar.webp"
import { Heart, LogOut, Edit, ChevronDown, Bot, Calendar } from 'lucide-react';
import { useState } from "react";
import { signOut } from "../../src/userServives/userServive";
import { useNavigate } from "react-router-dom";
import OverlayAdvice from "../_quiz/bot";
import { AnimatePresence } from "framer-motion";

const UserSidebar = ({ userData, closeSidebar }) => {

    const navigate = useNavigate();
    const [showBot, setShowBot] = useState(false);

    const menuItems = [
        { id: 'favorites', label: '個人詞語庫', icon: <Heart size={20} /> },
        { id: 'bot', label: '泰雅助手', icon: <Bot size={20} /> },
        { id: 'calendar', label: '行事曆', icon: <Calendar size={20} /> }
    ];

    const handleSignOut = () => {
        signOut();
        navigate("/");
    };

    return (
        <>
            <div className="sidebar-container">
                {/* 頂部個人資料 */}
                <div className="sidebar-profile">
                    <div className="profile-avatar-container">
                        <img src={userData.firestoreData.avatarUrl ? userData.firestoreData.avatarUrl : AvatarImg} alt="頭像" />
                        <div className="profile-info">
                            <h3>{userData.firestoreData.name}</h3>
                            <p>{userData.firestoreData.email}</p>
                            <span>{userData.firestoreData.identity}</span>
                        </div>
                    </div>

                    <div className="profile-actions">
                        <button
                            className="profile-btn edit-btn"
                            onClick={() => {
                                closeSidebar();
                                navigate("/edit", { state: userData });
                            }}
                        >
                            <Edit size={14} className="icon" /> 編輯資料
                        </button>
                        <button className="profile-btn logout-btn" onClick={handleSignOut}>
                            <LogOut size={14} className="icon" /> 登出
                        </button>
                    </div>
                </div>

                {/* 導航列 */}
                <div style={{ background: "#F9F5F0" }}>
                    <nav className="sidebar-nav">
                        {menuItems.map(({ id, label, icon }) => (
                            <button
                                key={id}
                                className={`nav-button`}
                                onClick={() => {
                                    if (id == "calendar") {
                                        navigate("/" + id);
                                    } else if (id == "bot") {
                                        setShowBot(true);
                                    } else if (id == "favorites") {
                                        navigate('/favorite', { state: { tabId: 1 } });
                                    } else if (id == "social") {
                                        navigate('/social', { state: userData });
                                    }
                                    closeSidebar();
                                    // setActiveSection(id)
                                }}
                            >
                                <div className="nav-content">
                                    <span className="nav-icon" style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>
                                    <span className="nav-label">{label}</span>
                                </div>
                                <ChevronDown size={18} className="nav-chevron" />
                            </button>
                        ))}
                    </nav>
                </div>

                {/* 底部資訊 */}
                <div className="p-3 border-t text-center text-sm" style={{ borderColor: "rgba(232, 195, 158, 0.314)", color: "#543729" }}>
                    ⓘ 泰雅族語學習平台
                </div>
            </div>

            <AnimatePresence>
                {showBot && <OverlayAdvice onClose={() => setShowBot(false)} />}
            </AnimatePresence>
        </>
    );
};
export default UserSidebar;