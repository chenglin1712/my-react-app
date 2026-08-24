import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "../../static/css/_quiz/sideBar.css"
import { ClipboardList, ChartPie, Star, Play, X, Menu } from "lucide-react"
import { TRIBES } from "../../src/constants/tribes";

const ICONS = {
    quiz: <ClipboardList size={24} fill="#A6E3A1" color="#28A745" />,
    situation: <ChartPie size={24} color="#007BFF" />,
    review: <Star size={24} fill="#FFECB3" color="#FFD700" />,
    play: <Play size={22} fill="#8B0000" color="#8B0000" />,
    menu: <Menu size={25} color="#8B0000" />,
    close: <X size={24} color="#8B0000" />,
};
const MENU_ITEMS = [
    { key: "quiz", text: "開始測驗" },
    { key: "situation", text: "答題情形" },
    { key: "review", text: "重點複習" },
];
// 合法 slug 來自 TRIBES 單一資料來源，不是另外寫死一份族語清單——新增族語時
// TRIBES 更新了，這裡不會漏掉。
const NON_TAYAL_SLUGS = TRIBES.map((t) => t.slug).filter((slug) => slug !== "tayal");
const TRIBE_PATH_PATTERN = new RegExp(`^/quiz/(${NON_TAYAL_SLUGS.join("|")})(/|$)`);

const SideBar = () => {
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const currentUrl = useLocation().pathname;
    // /quiz/amis、/quiz/bunun 等非泰雅語路徑要留在自己的族語底下，
    // 泰雅語沒有族語路徑前綴（歷史因素維持 /quiz 不變）。
    const tribeMatch = currentUrl.match(TRIBE_PATH_PATTERN);
    const quizBasePath = tribeMatch ? `/quiz/${tribeMatch[1]}` : "/quiz";

    // 目前選中的功能完全由目前路徑推導，不再另外存一份 state——原本
    // selectFunc 初始值是完整 pathname、按過選單後又被設成 "quiz"/"review"
    // 這種短 key，同一個 state 存了兩種不同形狀的值；瀏覽器上一頁/下一頁、或
    // 從其他地方直接 navigate 過來時，這份 state 也不會跟著同步。
    const selectFunc = currentUrl.includes("/recommon")
        ? "recommon"
        : currentUrl.includes("/situation")
            ? "situation"
            : currentUrl.includes("/review")
                ? "review"
                : "quiz";

    //點功能選單
    const clickFunc = (func) => {
        let path;
        if (func === "quiz") {
            path = quizBasePath;
        } else if (func === "recommon") {
            // 推薦測驗要留在目前所在的族語底下（呼應上面 quizBasePath 的邏輯），
            // 不像 situation/review 是跨族語共用的頁面
            path = `${quizBasePath}/recommon`;
        } else {
            path = "/quiz/" + func;
        }
        navigate(path);
        setOpen(false);
    };

    return (
        <>
            <div className="bar-container">
                <h2 className="bar-title">測驗選單</h2>
                <div className="bar-items">
                    <div className={`bar-item ${!["situation", "review", "recommon"].includes(selectFunc) ? "active" : ""}`} onClick={() => { clickFunc("quiz") }}>
                        <span>基礎-等級測驗</span>
                        <div className={`func-hint ${!["situation", "review", "recommon"].includes(selectFunc) ? "active" : ""}`}>
                            {ICONS.play}
                        </div>
                    </div>
                    <div className={`bar-item ${selectFunc === "recommon" ? "active" : ""}`} onClick={() => { clickFunc("recommon") }}>
                        <span>進階-推薦測驗</span>
                        <div className={`func-hint ${selectFunc === "recommon" ? "active" : ""}`}>
                            {ICONS.play}
                        </div>
                    </div>

                    <h2 className="bar-title">紀錄</h2>
                    <div className={`bar-item ${selectFunc === "situation" ? "active" : ""}`} onClick={() => { clickFunc("situation") }}>
                        <div className="bar-item-chart" style={{ background: "#A7C7E7" }} >
                            {ICONS.situation}
                        </div>
                        <span>答題情形</span>
                        <div className={`func-hint ${selectFunc === "situation" ? "active" : ""}`}>
                            {ICONS.play}
                        </div>
                    </div>
                    <div className={`bar-item ${selectFunc === "review" ? "active" : ""}`} onClick={() => { clickFunc("review") }}>
                        <div className="bar-item-chart" >
                            {ICONS.review}
                        </div>
                        <span>重點複習</span>
                        <div className={`func-hint ${selectFunc === "review" ? "active" : ""}`}>
                            {ICONS.play}
                        </div>
                    </div>
                </div>
            </div>

            {/* Mobile bar */}
            <div className="mobile-bar-menu">
                <button className="mobile-menu-button" onClick={() => setOpen(!open)} aria-label={open ? "關閉選單" : "開啟選單"}>
                    {ICONS[selectFunc]}
                    <div className="mobile-menu-indicator">{ICONS.menu}</div>
                </button>

                {open && (
                    <div className="mobile-menu">
                        <div className="mobile-menu-header">
                            <span>功能選單</span>
                            <button className="mobile-closeBtn" onClick={() => setOpen(false)} aria-label="關閉選單">
                                {ICONS.close}
                            </button>
                        </div>

                        <div className="mobile-menu-items">
                            {MENU_ITEMS.map(({ key, text }) => (
                                <div key={key} className="mobile-menu-item" onClick={() => clickFunc(key)}>
                                    {ICONS[key]} <span>{text}</span>
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