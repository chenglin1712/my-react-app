import { useNavigate } from "react-router-dom";
import "../../static/css/_game/zone.css";
import { Container } from "react-bootstrap";

const TRIBES = [
  {
    id: "tayal",
    name: "泰雅",
    subtitle: "Tayal",
    emoji: "📝",
    available: true,
    route: "/quiz",
  },
  {
    id: "amis",
    name: "阿美",
    subtitle: "Amis",
    emoji: "📝",
    available: false,
  },
  {
    id: "bunun",
    name: "布農",
    subtitle: "Bunun",
    emoji: "📝",
    available: false,
  },
  {
    id: "kavalan",
    name: "葛瑪蘭",
    subtitle: "Kavalan",
    emoji: "📝",
    available: false,
  },
  {
    id: "paiwan",
    name: "排灣",
    subtitle: "Paiwan",
    emoji: "📝",
    available: false,
  },
];

const QuizTribeSelect = () => {
  const navigate = useNavigate();

  return (
    <Container>
      <div className="zone-page">
        <div className="zone-header">
          <h1 className="zone-title">測驗</h1>
          <p className="zone-subtitle">選擇族語，開始自適應測驗學習</p>
        </div>

        <div className="zone-grid">
          {TRIBES.map((tribe) => (
            <div
              key={tribe.id}
              className={`zone-card ${tribe.available ? "available" : "disabled"}`}
              style={tribe.available ? { borderColor: getTribeColor(tribe.id) } : {}}
              onClick={() => tribe.available && navigate(tribe.route)}
            >
              <div className="zone-card-emoji">{tribe.emoji}</div>
              <div className="zone-card-body">
                <h2 className="zone-card-title">{tribe.name}族語</h2>
                <p className="zone-card-subtitle" style={{ color: getTribeColor(tribe.id) }}>
                  {tribe.subtitle}
                </p>
              </div>
              <div
                className={`zone-card-badge ${tribe.available ? "badge-open" : "badge-soon"}`}
                style={tribe.available ? { background: getTribeColor(tribe.id) } : {}}
              >
                {tribe.available ? "進入測驗" : "建置中，敬請期待"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Container>
  );
};

function getTribeColor(id) {
  const colors = {
    tayal: "#9B1B30",
    amis: "#D4890A",
    bunun: "#4E7F63",
    kavalan: "#4A7FA5",
    paiwan: "#6B4FAA",
  };
  return colors[id] || "#9B1B30";
}

export default QuizTribeSelect;
