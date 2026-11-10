import "../../static/css/navigation/userSidebar.css"
import AvatarImg from "../../static/assets/_auth/avatar.webp"
import { Heart, LogOut, Edit, ChevronRight, Bot, Calendar, Brain, Info, CircleAlert } from 'lucide-react';
import { useState } from "react";
import { signOut } from "../../src/userServives/userServive";
import { useNavigate } from "react-router-dom";

// AI 助手 overlay 的實際 render 交給 AppShell（見 AppShell.jsx）：這裡是導覽層
// 的基礎元件，不該反過來 lazy import 功能模組 _quiz/bot 並自己管理開關狀態。
const UserSidebar = ({ userData, closeSidebar, onOpenBot }) => {

    const navigate = useNavigate();
    const [signOutError, setSignOutError] = useState("");

    // 「我的學習記憶」放在 AI 助手旁邊：它是助手記住學習狀況的功能，從這裡兩下就到
    const menuItems = [
        { id: 'favorites', label: '個人詞語庫', icon: <Heart size={20} />, go: () => navigate('/favorite', { state: { tabId: 1 } }) },
        { id: 'bot', label: 'AI 助手', icon: <Bot size={20} />, go: onOpenBot },
        { id: 'memory', label: '我的學習記憶', icon: <Brain size={20} />, go: () => navigate('/memory') },
        { id: 'calendar', label: '行事曆', icon: <Calendar size={20} />, go: () => navigate('/calendar') },
    ];

    const handleSignOut = async () => {
        try {
            await signOut();
            navigate("/");
        } catch (err) {
            console.error("登出失敗", err);
            setSignOutError("登出失敗，請稍後再試。");
        }
    };

    return (
            <div className="sidebar-container">
                {/* 頂部個人資料 */}
                <div className="sidebar-profile">
                    <div className="profile-avatar-container">
                        <img decoding="async" loading="lazy" src={userData.firestoreData.avatarUrl ? userData.firestoreData.avatarUrl : AvatarImg} alt="頭像" />
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
                            <Edit size={14} className="icon" aria-hidden="true" /> 編輯資料
                        </button>
                        <button className="profile-btn logout-btn" onClick={handleSignOut}>
                            <LogOut size={14} className="icon" aria-hidden="true" /> 登出
                        </button>
                    </div>
                    {signOutError && (
                        <p className="sidebar-signout-error" role="alert">
                            <CircleAlert size={16} aria-hidden="true" />
                            {signOutError}
                        </p>
                    )}
                </div>

                {/* 導航列 */}
                <div className="sidebar-nav-wrap">
                    <nav className="sidebar-nav" aria-label="個人選單">
                        {menuItems.map(({ id, label, icon, go }) => (
                            <button
                                key={id}
                                type="button"
                                className="nav-button"
                                onClick={() => {
                                    go();
                                    closeSidebar();
                                }}
                            >
                                <div className="nav-content">
                                    <span className="nav-icon" aria-hidden="true">{icon}</span>
                                    <span className="nav-label">{label}</span>
                                </div>
                                <ChevronRight size={18} className="nav-chevron" aria-hidden="true" />
                            </button>
                        ))}
                    </nav>
                </div>

                {/* 底部資訊 */}
                <div className="sidebar-footer">
                    <Info size={14} aria-hidden="true" />
                    原住民族語學習平台
                </div>
            </div>
    );
};
export default UserSidebar;
