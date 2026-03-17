import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "../../static/css/_quiz/sideBar.css"
import { ClipboardList, ChartPie, Star, Play, X, Menu } from "lucide-react"
import { useLocation } from 'react-router-dom';

const SideBar = ({ }) => {
    const icons = {
        quiz: <ClipboardList size={24} fill="#A6E3A1" color="#28A745" />,
        situation: <ChartPie size={24} color="#007BFF" />,
        review: <Star size={24} fill="#FFECB3" color="#FFD700" />,
        play: <Play size={22} fill="#8B0000" color="#8B0000" />,
        menu: <Menu size={25} color="#8B0000" />,
        close: <X size={24} color="#8B0000" />,
    };
    const menuItems = [
        { key: "quiz", text: "開始測驗" },
        { key: "situation", text: "答題情形" },
        { key: "review", text: "重點複習" },
    ];
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const currentUrl = useLocation().pathname;
    const [selectFunc, setSelectFunc] = useState(currentUrl); //預設為開始測驗

    //點功能選單
    const clickFunc = (func) => {
        let path = "/quiz";
        path += func.includes("quiz") ? "" : "/" + func;
        navigate(path);
        setSelectFunc(func);
    };

    return (
        <>
            <div className="bar-container">
                <h2 className="bar-title">測驗選單</h2>
                <div className="bar-items">
                    <div className={`bar-item ${!["situation", "review", "recommon"].includes(selectFunc) ? "active" : ""}`} onClick={() => { clickFunc("quiz") }}>
                        <span>基礎-等級測驗</span>
                        <div className={`func-hint ${!["situation", "review", "recommon"].includes(selectFunc) ? "active" : ""}`}>
                            {icons.play}
                        </div>
                    </div>
                    <div className={`bar-item ${selectFunc == "recommon" ? "active" : ""}`} onClick={() => { clickFunc("recommon") }}>
                        <span>進階-推薦測驗</span>
                        <div className={`func-hint ${selectFunc == "recommon" ? "active" : ""}`}>
                            {icons.play}
                        </div>
                    </div>

                    <h2 className="bar-title">紀錄</h2>
                    <div className={`bar-item ${selectFunc == "situation" ? "active" : ""}`} onClick={() => { clickFunc("situation") }}>
                        <div className="bar-item-chart" style={{ background: "#A7C7E7" }} >
                            {icons.situation}
                        </div>
                        <span>答題情形</span>
                        <div className={`func-hint ${selectFunc == "situation" ? "active" : ""}`}>
                            {icons.play}
                        </div>
                    </div>
                    <div className={`bar-item ${selectFunc == "review" ? "active" : ""}`} onClick={() => { clickFunc("review") }}>
                        <div className="bar-item-chart" >
                            {icons.review}
                        </div>
                        <span>重點複習</span>
                        <div className={`func-hint ${selectFunc == "review" ? "active" : ""}`}>
                            {icons.play}
                        </div>
                    </div>
                </div>
            </div>

            {/* Mobile bar */}
            <div className="mobile-bar-menu">
                <button className="mobile-menu-button" onClick={() => setOpen(!open)}>
                    {icons[selectFunc]}
                    <div className="mobile-menu-indicator">{icons.menu}</div>
                </button>

                {open && (
                    <div className="mobile-menu">
                        <div className="mobile-menu-header">
                            <span>功能選單</span>
                            <button className="mobile-closeBtn" onClick={() => setOpen(false)}>
                                {icons.close}
                            </button>
                        </div>

                        <div className="mobile-menu-items">
                            {menuItems.map(({ key, text }) => (
                                <div key={key} className="mobile-menu-item" onClick={() => { clickFunc(key); setOpen(false); }}>
                                    {icons[key]} <span>{text}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                )}
            </div>
        </>
    );
};
export default SideBar;