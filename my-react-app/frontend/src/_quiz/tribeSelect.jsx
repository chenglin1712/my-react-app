import { useNavigate } from "react-router-dom";
import "../../static/css/_game/zone.css";
import { Container } from "react-bootstrap";
import { TRIBES as TRIBE_LIST } from "../constants/tribes";

// subtitle/emoji/available/route 是這個頁面自己的呈現用資料，跟名稱對照表分開放；
// 名稱（name）跟英文代稱（id，沿用原本 tribe.id 這個欄位名）一律從共用的
// TRIBE_LIST 取得，subtitle 就是 slug 首字大寫。
const TRIBE_ROUTES = { tayal: "/quiz", amis: "/quiz/amis", bunun: "/quiz/bunun", kavalan: "/quiz/kavalan", paiwan: "/quiz/paiwan" };
const TRIBES = TRIBE_LIST.map((t) => ({
  id: t.slug,
  name: t.name,
  subtitle: t.slug.charAt(0).toUpperCase() + t.slug.slice(1),
  emoji: "📝",
  available: true,
  route: TRIBE_ROUTES[t.slug],
}));

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
