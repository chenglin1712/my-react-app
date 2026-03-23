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
    subtitle: "Coming Soon",
    desc: "聆聽族語發音，辨識正確詞彙",
    emoji: "🎧",
    available: false,
  },
  {
    id: "pronunciation",
    title: "發音練習",
    subtitle: "Coming Soon",
    desc: "跟著發音範本，練習族語正確發音",
    emoji: "🎤",
    available: false,
  },
  {
    id: "sentence",
    title: "句型練習",
    subtitle: "Coming Soon",
    desc: "學習族語基礎句型與日常用語",
    emoji: "📖",
    available: false,
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
