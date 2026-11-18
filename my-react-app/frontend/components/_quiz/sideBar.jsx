import { useNavigate, useLocation } from "react-router-dom";
import "../../static/css/_quiz/sideBar.css"
import { ClipboardList, ChartPie, Star, Sparkles } from "lucide-react"
import { TRIBES } from "../../src/constants/tribes";

// 圖示一律用 currentColor（顏色由 sideBar.css 決定，選取時跟著變成象牙色），不在這裡寫死顏色。
const ICONS = {
    quiz: <ClipboardList size={22} aria-hidden="true" />,
    situation: <ChartPie size={22} aria-hidden="true" />,
    review: <Star size={22} aria-hidden="true" />,
    recommon: <Sparkles size={22} aria-hidden="true" />,
};
// 桌面側欄與手機頂部頁籤共用同一份項目與同一組 button：只有排版不同（P4-5）。
// 原本手機版少了「進階-推薦測驗」（審查項 P1-2），共用之後不會再漏。
const MENU_ITEMS = [
    { key: "quiz", text: "基礎-等級測驗", group: "測驗" },
    { key: "recommon", text: "進階-推薦測驗", group: "測驗" },
    { key: "situation", text: "答題情形", group: "紀錄" },
    { key: "review", text: "重點複習", group: "紀錄" },
];
const GROUPS = ["測驗", "紀錄"];
// 合法 slug 來自 TRIBES 單一資料來源，不是另外寫死一份族語清單——新增族語時
// TRIBES 更新了，這裡不會漏掉。
const NON_TAYAL_SLUGS = TRIBES.map((t) => t.slug).filter((slug) => slug !== "tayal");
const TRIBE_PATH_PATTERN = new RegExp(`^/quiz/(${NON_TAYAL_SLUGS.join("|")})(/|$)`);

const SideBar = () => {
    const navigate = useNavigate();
    const currentUrl = useLocation().pathname;
    // /quiz/amis、/quiz/bunun 等非泰雅語路徑要留在自己的族語底下，
    // 泰雅語沒有族語路徑前綴（歷史因素維持 /quiz 不變）。
    const tribeMatch = currentUrl.match(TRIBE_PATH_PATTERN);
    const quizBasePath = tribeMatch ? `/quiz/${tribeMatch[1]}` : "/quiz";

    // 目前選中的功能完全由目前路徑推導，不再另外存一份 state——瀏覽器上一頁/下一頁、
    // 或從其他地方直接 navigate 過來時，才不會跟著不同步。
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
    };

    return (
        <nav className="bar-container" aria-label="測驗選單">
            <div className="bar-items">
                {GROUPS.map((group) => (
                    <div key={group} className="bar-group" role="group" aria-label={group}>
                        {/* 群組標題只在桌面側欄顯示；手機頁籤列用群組的無障礙名稱，不佔位置 */}
                        <h2 className="bar-title">{group}</h2>
                        {MENU_ITEMS.filter((item) => item.group === group).map(({ key, text }) => {
                            const active = selectFunc === key;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    className={`bar-item${active ? " active" : ""}`}
                                    aria-current={active ? "page" : undefined}
                                    onClick={() => clickFunc(key)}
                                >
                                    <span className="bar-item-icon">{ICONS[key]}</span>
                                    <span className="bar-item-label">{text}</span>
                                    {/* 目前頁的文字標示（P4-5）：不只靠顏色；報讀器讀的是 aria-current */}
                                    {active && <span className="bar-item-current" aria-hidden="true">目前</span>}
                                </button>
                            );
                        })}
                    </div>
                ))}
            </div>
        </nav>
    );
};
export default SideBar;
