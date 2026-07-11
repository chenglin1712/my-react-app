import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "../../static/css/_game/vocabulary.css";
import { TRIBES as TRIBE_LIST } from "../constants/tribes";

// 顏色是這個頁面自己的呈現用資料，不是族語本身的屬性，跟名稱對照表分開放；
// 名稱一律從共用的 TRIBE_LIST 取得。
const TRIBE_COLORS = { tayal: "#9B1B30", amis: "#D4890A", bunun: "#4E7F63", kavalan: "#4A7FA5", paiwan: "#6B4FAA" };
const TRIBES = TRIBE_LIST.map((t) => ({
  name: t.name,
  color: TRIBE_COLORS[t.slug],
  hasGame: true,
  route: `/game/sentence/${t.slug}`,
}));

const SentencePage = () => {
  const navigate = useNavigate();
  const [selectedTribe, setSelectedTribe] = useState(null);

  const handleTribeClick = (tribe) => {
    if (tribe.hasGame && tribe.route) {
      navigate(tribe.route);
    } else {
      setSelectedTribe(tribe.name === selectedTribe ? null : tribe.name);
    }
  };

  return (
    <div className="vocab-page">
      <div className="vocab-header">
        <button className="vocab-back-btn" onClick={() => navigate("/game")}>
          ← 返回遊戲專區
        </button>
        <h1 className="vocab-title">句型練習</h1>
        <p className="vocab-subtitle">選擇族語，開始練習</p>
      </div>

      <div className="vocab-tribe-grid">
        {TRIBES.map((tribe) => (
          <div
            key={tribe.name}
            className={`vocab-tribe-card ${selectedTribe === tribe.name ? "selected" : ""} ${!tribe.hasGame ? "coming-soon" : ""}`}
            style={{ "--tribe-color": tribe.color }}
            onClick={() => handleTribeClick(tribe)}
          >
            <div className="vocab-tribe-badge" style={{ background: tribe.color }}>
              {tribe.name}
            </div>
            <div className="vocab-tribe-name">{tribe.name}族語</div>
            {tribe.hasGame ? (
              <div className="vocab-tribe-tag available">開始練習 →</div>
            ) : (
              <div className="vocab-tribe-tag building">遊戲建置中</div>
            )}
          </div>
        ))}
      </div>

      {selectedTribe && (
        <div className="vocab-coming-state">
          <div
            className="vocab-coming-badge"
            style={{ background: TRIBES.find((t) => t.name === selectedTribe)?.color }}
          >
            {selectedTribe}
          </div>
          <h3 className="vocab-coming-title">{selectedTribe}族語句型練習</h3>
          <p className="vocab-coming-desc">遊戲建置中，敬請期待</p>
        </div>
      )}
    </div>
  );
};

export default SentencePage;
