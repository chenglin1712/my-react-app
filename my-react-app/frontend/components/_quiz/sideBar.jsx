import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "../../static/css/_quiz/sideBar.css"
import { ClipboardList, ChartPie, Star, Play, X, Menu, Sparkles } from "lucide-react"
import { TRIBES } from "../../src/constants/tribes";

const ICONS = {
    quiz: <ClipboardList size={24} style={{ color: "var(--yy-green)", fill: "var(--yy-success-bg)" }} />,
    situation: <ChartPie size={24} style={{ color: "var(--yy-blue-light)" }} />,
    review: <Star size={24} style={{ color: "var(--yy-gold)", fill: "var(--yy-warning-bg)" }} />,
    recommon: <Sparkles size={24} style={{ color: "var(--yy-red)", fill: "var(--yy-warning-bg)" }} />,
    play: <Play size={22} style={{ color: "var(--yy-red)", fill: "var(--yy-red)" }} />,
    menu: <Menu size={25} style={{ color: "var(--yy-red)" }} />,
    close: <X size={24} style={{ color: "var(--yy-red)" }} />,
};
// 手機選單與桌機側欄共用同一份項目：原本手機版少了「進階-推薦測驗」，
// 進入該頁時 ICONS[selectFunc] 是 undefined，按鈕上的圖示是空的（審查項 P1-2）。
const MENU_ITEMS = [
    { key: "quiz", text: "基礎-等級測驗" },
    { key: "recommon", text: "進階-推薦測驗" },
    { key: "situation", text: "答題情形" },
    { key: "review", text: "重點複習" },
];
const MOBILE_MENU_ID = "quiz-mobile-menu";
// 合法 slug 來自 TRIBES 單一資料來源，不是另外寫死一份族語清單——新增族語時
// TRIBES 更新了，這裡不會漏掉。
const NON_TAYAL_SLUGS = TRIBES.map((t) => t.slug).filter((slug) => slug !== "tayal");
const TRIBE_PATH_PATTERN = new RegExp(`^/quiz/(${NON_TAYAL_SLUGS.join("|")})(/|$)`);

const SideBar = () => {
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const mobileToggleRef = useRef(null);
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

    // 手機選單開著時按 Esc 關閉，焦點回到開啟它的按鈕
    useEffect(() => {
        if (!open) return undefined;
        const handleKeyDown = (event) => {
            if (event.key !== "Escape") return;
            setOpen(false);
            mobileToggleRef.current?.focus();
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [open]);

    // 側欄項目原本是掛 onClick 的 div：沒有 role、不能 Tab、不能用 Enter/Space，
    // 純鍵盤與報讀器使用者進不了整個測驗區（審查項 P1-1）。改成 button，並用 aria-current 標示目前頁。
    const isActive = (key) => (key === "quiz"
        ? !["situation", "review", "recommon"].includes(selectFunc)
        : selectFunc === key);

    return (
        <>
            <nav className="bar-container" aria-label="測驗選單">
                <h2 className="bar-title">測驗選單</h2>
                <div className="bar-items">
                    {MENU_ITEMS.slice(0, 2).map(({ key, text }) => (
                        <button
                            key={key}
                            type="button"
                            className={`bar-item ${isActive(key) ? "active" : ""}`}
                            aria-current={isActive(key) ? "page" : undefined}
                            onClick={() => clickFunc(key)}
                        >
                            <span className="bar-item-label">{text}</span>
                            <span className={`func-hint ${isActive(key) ? "active" : ""}`} aria-hidden="true">{ICONS.play}</span>
                        </button>
                    ))}

                    <h2 className="bar-title">紀錄</h2>
                    {MENU_ITEMS.slice(2).map(({ key, text }) => (
                        <button
                            key={key}
                            type="button"
                            className={`bar-item ${isActive(key) ? "active" : ""}`}
                            aria-current={isActive(key) ? "page" : undefined}
                            onClick={() => clickFunc(key)}
                        >
                            <span className="bar-item-chart" aria-hidden="true" style={key === "situation" ? { background: "#DFE9EC" } : undefined}>
                                {ICONS[key]}
                            </span>
                            <span className="bar-item-label">{text}</span>
                            <span className={`func-hint ${isActive(key) ? "active" : ""}`} aria-hidden="true">{ICONS.play}</span>
                        </button>
                    ))}
                </div>
            </nav>

            {/* Mobile bar */}
            <div className="mobile-bar-menu">
                <button
                    ref={mobileToggleRef}
                    type="button"
                    className="mobile-menu-button"
                    onClick={() => setOpen(!open)}
                    aria-label={open ? "關閉選單" : "開啟選單"}
                    aria-expanded={open}
                    aria-controls={MOBILE_MENU_ID}
                >
                    <span aria-hidden="true">{ICONS[selectFunc]}</span>
                    <span className="mobile-menu-indicator" aria-hidden="true">{ICONS.menu}</span>
                </button>

                {open && (
                    <nav id={MOBILE_MENU_ID} className="mobile-menu" aria-label="測驗功能選單">
                        <div className="mobile-menu-header">
                            <span>功能選單</span>
                            <button type="button" className="mobile-closeBtn" onClick={() => { setOpen(false); mobileToggleRef.current?.focus(); }} aria-label="關閉選單">
                                {ICONS.close}
                            </button>
                        </div>

                        <div className="mobile-menu-items">
                            {MENU_ITEMS.map(({ key, text }) => (
                                <button
                                    key={key}
                                    type="button"
                                    className="mobile-menu-item"
                                    aria-current={selectFunc === key ? "page" : undefined}
                                    onClick={() => clickFunc(key)}
                                >
                                    <span aria-hidden="true">{ICONS[key]}</span> <span>{text}</span>
                                </button>
                            ))}
                        </div>
                    </nav>
                )}
            </div>
        </>
    );
};
export default SideBar;