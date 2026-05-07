import { useNavigate } from "react-router-dom";
import "../../static/css/_game/index.css";
import "../../static/css/_game/zone.css";

const GAMES = [
  {
    id: "vocabulary",
    title: "詞彙遊戲",
    subtitle: "Tninun ATAYAL",
    desc: "從族語詞彙中挑選正確對應，訓練詞彙記憶能力",
    emoji: "🧵",
    available: true,
    route: "/game/vocabulary",
  },
  {
    id: "listening",
    title: "聽力遊戲",
    subtitle: "Misaniq ATAYAL",
    desc: "聆聽族語發音，辨識正確詞彙，訓練耳朵的敏銳度",
    emoji: "🎧",
    available: true,
    route: "/game/listening",
  },
  {
    id: "pronunciation",
    title: "發音練習",
    subtitle: "Qmisan ATAYAL",
    desc: "跟著發音範本錄音，AI 即時評分你的發音準確度",
    emoji: "🎤",
    available: true,
    route: "/game/pronunciation",
  },
  {
    id: "sentence",
    title: "句型練習",
    subtitle: "Lmuhuw ATAYAL",
    desc: "閱讀族語例句，選出正確的中文意思，訓練句型理解能力",
    emoji: "📖",
    available: true,
    route: "/game/sentence",
  },
];

const GameZonePage = () => {
  const navigate = useNavigate();

  return (
    <div className="zone-page">
      <div className="zone-header">
        <h1 className="zone-title">遊戲專區</h1>
        <p className="zone-subtitle">透過遊戲，輕鬆學習原住民族語</p>
      </div>

      <div className="zone-grid">
        {GAMES.map((game) => (
          <div
            key={game.id}
            className={`zone-card ${game.available ? "available" : "disabled"}`}
            onClick={() => game.available && navigate(game.route)}
          >
            <div className="zone-card-emoji">{game.emoji}</div>
            <div className="zone-card-body">
              <h2 className="zone-card-title">{game.title}</h2>
              <p className="zone-card-subtitle">{game.subtitle}</p>
              <p className="zone-card-desc">{game.desc}</p>
            </div>
            <div className={`zone-card-badge ${game.available ? "badge-open" : "badge-soon"}`}>
              {game.available ? "立即遊玩" : "建置中，敬請期待"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default GameZonePage;
