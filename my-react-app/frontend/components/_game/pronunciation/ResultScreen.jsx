import { Link } from "react-router-dom";

export default function ResultScreen({ avg, avgRating, answers, thresholds, getRating, backTo, onRestart }) {
  return (
    <div className="pron-result">
      <h2 className="pron-result-title">發音練習結果</h2>

      <div className={`pron-result-score ${avgRating.cls}`}>
        <span className="pron-result-num">{avg}</span>
        <span className="pron-result-unit">分</span>
        <p className="pron-result-rating">{avgRating.label}</p>
      </div>

      <div className="pron-result-list">
        {answers.map((a, i) => {
          const r = getRating(a.score, thresholds);
          return (
            <div key={`${a.word}-${i}`} className={`pron-result-row ${r.cls}`}>
              <span className="pron-result-word">{a.word}</span>
              <span className="pron-result-meaning">{a.meaning}</span>
              <span className={`pron-result-tag ${r.cls}`}>
                {a.score} 分{a.usedRef ? " ✦" : ""}
              </span>
            </div>
          );
        })}
      </div>
      <p className="pron-result-hint">✦ 表示有真人音檔參與比對</p>

      <div className="pron-result-actions">
        <Link className="pron-btn-secondary" to={backTo}>
          ← 返回遊戲頁面
        </Link>
        <button type="button" className="pron-btn-primary" onClick={onRestart}>
          再練一次
        </button>
      </div>
    </div>
  );
}
