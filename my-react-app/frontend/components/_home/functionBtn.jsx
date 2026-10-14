import "../../static/css/_home/functionBtn.css"
import { Link } from "react-router-dom";

// 辭典（單詞查詢）是不用登入就能用的入口，放在第一張；其餘三張需要登入，
// 訪客看到時標「會員」，點下去會先看到說明再選登入或註冊（見 userServives/permissionProtect.jsx）。
// 說明文字只留一句，完整功能留給各模組自己的頁面介紹。
const FUNCTION_CARDS = [
    {
        id: "search",
        tag: "DICTIONARY",
        letter: "辭",
        title: "單詞查詢",
        desc: "查詢族語單詞的詞義、發音與例句。",
        route: "/search",
        headerBg: "linear-gradient(90deg,var(--yy-green),var(--yy-blue-light),var(--yy-green))",
        memberOnly: false,
    },
    {
        id: "vision",
        tag: "VISION",
        letter: "影",
        title: "影像辨識",
        desc: "用相機拍下身邊的物件，查到對應的族語詞彙與發音，並存進個人詞語庫。",
        route: "/camera",
        headerBg: "linear-gradient(90deg,var(--yy-blue),var(--yy-red),var(--yy-blue))",
        enabledKey: "button1",
        memberOnly: true,
    },
    {
        id: "game",
        tag: "GAME",
        letter: "戲",
        title: "詞彙遊戲",
        desc: "詞彙填字、聽力、發音與句型四款遊戲，答錯的詞會在後續練習中再出現。",
        route: "/game",
        headerBg: "linear-gradient(90deg,var(--yy-red),var(--yy-gold),var(--yy-red))",
        enabledKey: "button2",
        memberOnly: true,
    },
    {
        id: "quiz",
        tag: "QUIZ",
        letter: "測",
        title: "測驗學習",
        desc: "依你的語言能力調整題目難度，提供個人化的學習評估。",
        route: "/quiz/select",
        headerBg: "linear-gradient(90deg,var(--yy-gold),var(--yy-red),var(--yy-gold))",
        enabledKey: "button3",
        memberOnly: true,
    },
];

// 後台首頁版位設定（見 backend/adminapi 的 HomepageConfig、/adminapi/public/
// homepage-config/）只開放「顯示/隱藏」影像辨識、遊戲、測驗三張卡片，不開放改
// 標題/說明/導向的 route——這幾個欄位如果讓後台自由填字，打錯字就會變成連到
// 不存在的路由，卡片內容跟每個功能模組本身是綁死的，不是可以任意替換的通用版位。
// 辭典卡沒有 enabledKey，永遠顯示。
const DEFAULT_ENABLED = { button1: true, button2: true, button3: true };

// isGuest：沒登入的訪客才標「會員」；已登入的人看到會是多餘的標記。
const FunctionBtn = ({ enabled = DEFAULT_ENABLED, isGuest = false }) => {
    const visibleCards = FUNCTION_CARDS.filter((card) => !card.enabledKey || enabled[card.enabledKey] !== false);
    return (
        <section className="function-section" aria-labelledby="function-section-title">
            <div className="function-section-header">
                <span className="yy-eyebrow">LEARNING TOOLS</span>
                <h2 className="function-section-title" id="function-section-title">功能模組</h2>
            </div>
            {/* 整張卡片就是一個 Link：原本外層 div 用 onClick 導頁、內部又包一顆
                真正的 button 並呼叫 stopPropagation 避免導頁兩次觸發——鍵盤只能
                停在內部按鈕，滑鼠卻整張卡片都能點，操作範圍不一致。改成單一 Link
                後滑鼠鍵盤的可互動範圍相同，「前往體驗 →」變成純視覺文字。
                無障礙名稱只取標題（與「會員」標記），說明放 aria-describedby，
                報讀器不會把標籤、菱形、整段說明一次唸完。 */}
            <div className="card-container">
                {visibleCards.map((card) => {
                    const showMember = isGuest && card.memberOnly;
                    const titleId = `function-card-${card.id}-title`;
                    const memberId = `function-card-${card.id}-member`;
                    return (
                        <Link
                            key={card.route}
                            to={card.route}
                            className="home-func-card yy-card--hover"
                            aria-labelledby={showMember ? `${titleId} ${memberId}` : titleId}
                            aria-describedby={`function-card-${card.id}-desc`}
                        >
                            <div className="card-head" style={{ background: card.headerBg }}>
                                <span className="card-tag" aria-hidden="true">{card.tag}</span>
                                {showMember
                                    ? <span className="card-member" id={memberId}>會員</span>
                                    : <span className="card-diamonds" aria-hidden="true">◆ ◆ ◆</span>}
                            </div>
                            <div className="card-content">
                                <div className="card-letter" aria-hidden="true">{card.letter}</div>
                                <h3 id={titleId}>{card.title}</h3>
                                <p id={`function-card-${card.id}-desc`}>{card.desc}</p>
                                <span className="card-cta" aria-hidden="true">前往體驗 →</span>
                            </div>
                        </Link>
                    );
                })}
            </div>
        </section>
    );
};
export default FunctionBtn;
