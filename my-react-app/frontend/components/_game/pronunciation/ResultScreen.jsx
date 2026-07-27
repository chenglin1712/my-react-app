export default function ResultScreen({ avg, avgRating, answers, ratingOf, onBack, onRestart }) {
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
          const r = ratingOf(a.score);
          return (
            <div key={i} className={`pron-result-row ${r.cls}`}>
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
        <button className="pron-btn-secondary" onClick={onBack}>
          ← 返回遊戲頁面
        </button>
        <button className="pron-btn-primary" onClick={onRestart}>
          再練一次
        </button>
      </div>
    </div>
  );
}
