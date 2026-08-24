import { Link } from "react-router-dom";
import "../../static/css/_game/gameTribeSelect.css";
import { TRIBES, TRIBE_COLOR_BY_SLUG } from "../constants/tribes";

// 詞彙/聽力/句型三個遊戲的「選擇族語」頁面原本各自複製了一份幾乎一樣的實作
// （包含同一個「hasGame 對每個族語都寫死 true，讓建置中分支永遠不會顯示」的
// 死碼問題）。抽成一個共用頁面，用 gameSlug 組出路由（跟 route.jsx 產生
// /game/{gameSlug}/{tribe} 路由是同一條規則）。
export default function GameTribeSelectPage({ gameSlug, title, subtitle, actionLabel }) {
  return (
    <div className="vocab-page">
      <div className="vocab-header">
        <Link className="vocab-back-btn" to="/game">
          ← 返回遊戲專區
        </Link>
        <h1 className="vocab-title">{title}</h1>
        <p className="vocab-subtitle">{subtitle}</p>
      </div>

      <div className="vocab-tribe-grid">
        {TRIBES.map((tribe) => (
          <Link
            key={tribe.slug}
            to={`/game/${gameSlug}/${tribe.slug}`}
            className="vocab-tribe-card"
            style={{ "--tribe-color": TRIBE_COLOR_BY_SLUG[tribe.slug] }}
          >
            <div className="vocab-tribe-badge" style={{ background: TRIBE_COLOR_BY_SLUG[tribe.slug] }}>
              {tribe.name}
            </div>
            <div className="vocab-tribe-name">{tribe.name}族語</div>
            <div className="vocab-tribe-tag available">{actionLabel} →</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
