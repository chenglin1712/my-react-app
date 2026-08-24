import { Link } from "react-router-dom";
import "../../static/css/_game/zone.css";
import { Container } from "react-bootstrap";
import { TRIBES, TRIBE_COLOR_BY_SLUG } from "../constants/tribes";
import StepBar from "../../components/ui/StepBar";

const QUIZ_STEPS = ["選擇族語", "選擇等級", "開始作答", "成績單"];

// route.jsx 對泰雅語的測驗路由用空字串（不是 "tayal"），其餘族語才用各自的
// slug——跟 route.jsx 產生路由用的是同一條規則，不是這裡另外發明的。
function quizPathForTribe(slug) {
  return slug === "tayal" ? "/quiz" : `/quiz/${slug}`;
}

const QuizTribeSelect = () => {
  return (
    <div className="yy-page">
    <Container>
      <div className="zone-page">
        <div className="zone-header">
          <span className="yy-eyebrow">◆ QUIZ MODE ◆</span>
          <h1 className="zone-title" style={{ marginTop: 12 }}>測驗</h1>
          <p className="zone-subtitle">選擇族語與等級，開始自適應測驗學習。</p>
          <div style={{ marginTop: 28, marginBottom: 8 }}>
            <StepBar steps={QUIZ_STEPS} current={1} />
          </div>
        </div>

        <div className="zone-grid">
          {TRIBES.map((tribe) => (
            <Link
              key={tribe.slug}
              to={quizPathForTribe(tribe.slug)}
              className="zone-card available"
              style={{ borderColor: TRIBE_COLOR_BY_SLUG[tribe.slug] }}
            >
              <div className="zone-card-emoji">📝</div>
              <div className="zone-card-body">
                <h2 className="zone-card-title">{tribe.name}族語</h2>
                <p className="zone-card-subtitle" style={{ color: TRIBE_COLOR_BY_SLUG[tribe.slug] }}>
                  {tribe.roman}
                </p>
              </div>
              <div
                className="zone-card-badge badge-open"
                style={{ background: TRIBE_COLOR_BY_SLUG[tribe.slug] }}
              >
                進入測驗
              </div>
            </Link>
          ))}
        </div>
      </div>
    </Container>
    </div>
  );
};

export default QuizTribeSelect;
