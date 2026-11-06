import "../../static/css/_game/celebrate.css";

// 結算頁的慶祝動態（Apple 化步驟 4-5）：從分數中心往外散開的一小撮圓點，一次性、不循環。
// 純裝飾：aria-hidden、不攔截點擊；成績文字本身由頁面照常提供。座標固定（不用亂數），畫面可重現、測試可預期。
// 減少動態時整個隱藏（見 celebrate.css）。只有成績達標才渲染，呼叫端用 celebrate.js 的 shouldCelebrate(pct) 判斷。

const PARTICLES = [
  [-92, -78], [-48, -104], [0, -118], [50, -102], [94, -76], [118, -22],
  [104, 38], [62, 86], [0, 104], [-64, 88], [-108, 32], [-120, -26],
];

const CelebrationBurst = () => (
  <span className="game-celebrate" aria-hidden="true">
    {PARTICLES.map(([x, y], i) => (
      <i key={i} className="game-celebrate-dot" style={{ "--dx": `${x}px`, "--dy": `${y}px`, "--i": i }} />
    ))}
  </span>
);

export default CelebrationBurst;
