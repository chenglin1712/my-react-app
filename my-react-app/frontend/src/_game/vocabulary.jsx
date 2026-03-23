import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "../../static/css/_game/vocabulary.css";

const TRIBES = [
  { name: "泰雅", color: "#9B1B30", hasGame: true },
  { name: "阿美", color: "#D4890A", hasGame: false },
  { name: "布農", color: "#4E7F63", hasGame: false },
  { name: "葛瑪蘭", color: "#4A7FA5", hasGame: false },
  { name: "排灣", color: "#6B4FAA", hasGame: false },
];

const VocabularyPage = () => {
  const navigate = useNavigate();
  const [selectedTribe, setSelectedTribe] = useState(null);

  const handleTribeClick = (tribe) => {
    if (tribe.hasGame) {
      navigate("/game/vocabulary/tayal");
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
        <h1 className="vocab-title">詞彙遊戲</h1>
        <p className="vocab-subtitle">選擇族語，開始挑戰</p>
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
              <div className="vocab-tribe-tag available">開始遊戲 →</div>
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
            style={{ background: TRIBES.find(t => t.name === selectedTribe)?.color }}
          >
            {selectedTribe}
          </div>
          <h3 className="vocab-coming-title">{selectedTribe}族語詞彙遊戲</h3>
          <p className="vocab-coming-desc">遊戲建置中，敬請期待</p>
        </div>
      )}
    </div>
  );
};

export default VocabularyPage;
