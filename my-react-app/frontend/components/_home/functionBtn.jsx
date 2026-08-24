import "../../static/css/_home/functionBtn.css"
import { Link } from "react-router-dom";

const FUNCTION_CARDS = [
    {
        tag: "VISION",
        letter: "影",
        title: "影像辨識",
        desc: "影像辨識詞彙學習模組中，使用者可透過攝像頭擷取目標物件，系統將進行影像辨識，檢索對應的原住民族語詞彙、語音及語義，辨識出的詞彙也可依個人喜好儲存於個人詞語庫。",
        route: "/camera",
        headerBg: "linear-gradient(90deg,#1F3A5C,#9E1B24,#1F3A5C)",
        enabledKey: "button1",
    },
    {
        tag: "GAME",
        letter: "戲",
        title: "詞彙遊戲",
        desc: "動態詞彙遊戲模組旨在強化使用者對詞語定義與單詞拼寫的連結，使用者需在橫豎交錯的填字格中輸入對應的族語詞彙。系統將記錄使用者的錯誤答案，並在後續測驗中強化練習，提升學習成效。",
        route: "/game",
        headerBg: "linear-gradient(90deg,#9E1B24,#D9A227,#9E1B24)",
        enabledKey: "button2",
    },
    {
        tag: "QUIZ",
        letter: "測",
        title: "測驗學習",
        desc: "AI適性測驗學習模組測驗將根據使用者的語言能力，動態調整測驗題目，提供個人化語言評估、加強學習策略。透過AI生成適應性題目，確保學習內容能動態適應使用者的進度。",
        route: "/quiz/select",
        headerBg: "linear-gradient(90deg,#D9A227,#9E1B24,#D9A227)",
        enabledKey: "button3",
    },
];

// 後台首頁版位設定（見 backend/adminapi 的 HomepageConfig、/adminapi/public/
// homepage-config/）只開放「顯示/隱藏」這三張卡片，不開放改標題/說明/導向的
// route——這幾個欄位如果讓後台自由填字，打錯字就會變成連到不存在的路由，
// 卡片內容跟每個功能模組本身是綁死的，不是可以任意替換的通用版位。
const DEFAULT_ENABLED = { button1: true, button2: true, button3: true };

const FunctionBtn = ({ enabled = DEFAULT_ENABLED }) => {
    const visibleCards = FUNCTION_CARDS.filter((card) => enabled[card.enabledKey] !== false);
    return (
        <section className="function-section">
            <div className="function-section-header">
                <span className="yy-eyebrow">LEARNING TOOLS</span>
                <h2 className="function-section-title">功能模組</h2>
            </div>
            {/* 整張卡片就是一個 Link：原本外層 div 用 onClick 導頁、內部又包一顆
                真正的 button 並呼叫 stopPropagation 避免導頁兩次觸發——鍵盤只能
                停在內部按鈕，滑鼠卻整張卡片都能點，操作範圍不一致。改成單一 Link
                後滑鼠鍵盤的可互動範圍相同，「前往體驗 →」變成純視覺文字。 */}
            <div className="card-container">
                {visibleCards.map((card) => (
                    <Link key={card.route} to={card.route} className="card yy-card--hover">
                        <div className="card-head" style={{ background: card.headerBg }}>
                            <span className="card-tag">{card.tag}</span>
                            <span className="card-diamonds">◆ ◆ ◆</span>
                        </div>
                        <div className="card-content">
                            <div className="card-letter">{card.letter}</div>
                            <h2>{card.title}</h2>
                            <p>{card.desc}</p>
                            <span className="card-cta">前往體驗 →</span>
                        </div>
                    </Link>
                ))}
            </div>
        </section>
    );
};
export default FunctionBtn;
