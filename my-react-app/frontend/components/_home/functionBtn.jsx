import "../../static/css/_home/functionBtn.css"
import { useNavigate } from "react-router-dom";

const FUNCTION_CARDS = [
    {
        tag: "VISION",
        letter: "影",
        title: "影像辨識",
        desc: "影像辨識詞彙學習模組中，使用者可透過攝像頭擷取目標物件，系統將進行影像辨識，檢索對應的原住民族語詞彙、語音及語義，辨識出的詞彙也可依個人喜好儲存於個人詞語庫。",
        route: "/camera",
        headerBg: "linear-gradient(90deg,#1F3A5C,#9E1B24,#1F3A5C)",
    },
    {
        tag: "GAME",
        letter: "戲",
        title: "詞彙遊戲",
        desc: "動態詞彙遊戲模組旨在強化使用者對詞語定義與單詞拼寫的連結，使用者需在橫豎交錯的填字格中輸入對應的族語詞彙。系統將記錄使用者的錯誤答案，並在後續測驗中強化練習，提升學習成效。",
        route: "/game",
        headerBg: "linear-gradient(90deg,#9E1B24,#D9A227,#9E1B24)",
    },
    {
        tag: "QUIZ",
        letter: "測",
        title: "測驗學習",
        desc: "AI適性測驗學習模組測驗將根據使用者的語言能力，動態調整測驗題目，提供個人化語言評估、加強學習策略。透過AI生成適應性題目，確保學習內容能動態適應使用者的進度。",
        route: "/quiz/select",
        headerBg: "linear-gradient(90deg,#D9A227,#9E1B24,#D9A227)",
    },
];

const FunctionBtn = () => {
    const navigate = useNavigate();
    return (
        <section className="function-section">
            <div className="function-section-header">
                <span className="yy-eyebrow">LEARNING TOOLS</span>
                <h2 className="function-section-title">功能模組</h2>
            </div>
            <div className="card-container">
                {FUNCTION_CARDS.map((card) => (
                    <div
                        key={card.route}
                        className="card yy-card--hover"
                        role="button"
                        tabIndex={0}
                        onClick={() => navigate(card.route)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(card.route); } }}
                    >
                        <div className="card-head" style={{ background: card.headerBg }}>
                            <span className="card-tag">{card.tag}</span>
                            <span className="card-diamonds">◆ ◆ ◆</span>
                        </div>
                        <div className="card-content">
                            <div className="card-letter">{card.letter}</div>
                            <h2>{card.title}</h2>
                            <p>{card.desc}</p>
                            <button onClick={(e) => { e.stopPropagation(); navigate(card.route); }}>前往體驗 →</button>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
};
export default FunctionBtn;
