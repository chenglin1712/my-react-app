export default function PlayingScreen({
  progressPct, current, questions, q, rating,
  onPlayRef, recState, onStartRecording, onStopRecording, onPlayUserAudio, onResetRecState,
  submitting, onSubmit, score, officialScore, error, onNext,
}) {
  return (
    <div className="pron-game">
      <div className="pron-progress">
        <div
          className="pron-progress-bar"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <p className="pron-counter">第 {current + 1} / {questions.length} 題</p>

      <div className="pron-card">
        <p className="pron-word">{q.word}</p>
        <p className="pron-meaning">{q.correct}</p>
        <button className="pron-play-btn" onClick={onPlayRef}>
          ▶ 聽範本發音
        </button>
      </div>

      <div className="pron-record-area">
        {recState === "idle" && (
          <button className="pron-mic-btn" onClick={onStartRecording}>
            🎤<span>開始錄音</span>
          </button>
        )}
        {recState === "recording" && (
          <button className="pron-mic-btn recording" onClick={onStopRecording}>
            ⏹<span>停止錄音</span>
          </button>
        )}
        {(recState === "recorded" || recState === "submitted") && (
          <div className="pron-recorded-actions">
            <button className="pron-btn-outline" onClick={onPlayUserAudio}>▶ 重聽錄音</button>
            {recState === "recorded" && (
              <>
                <button className="pron-btn-outline" onClick={onResetRecState}>↺ 重新錄音</button>
                <button className="pron-btn-primary" onClick={onSubmit} disabled={submitting}>
                  {submitting ? "比對中..." : "送出比對"}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {recState === "submitted" && rating && (
        <div className={`pron-score-box ${rating.cls}`}>
          <span className="pron-score-num">{score}</span>
          <span className="pron-score-label">分 — {rating.label}</span>
          {officialScore !== null && score !== officialScore && (
            <span className="pron-score-ref">（官方音檔：{officialScore} 分 · 真人音檔優化）</span>
          )}
        </div>
      )}

      {error && <p className="pron-error">{error}</p>}

      {recState === "submitted" && (
        <button className="pron-btn-primary pron-next-btn" onClick={onNext}>
          {current + 1 < questions.length ? "下一題 →" : "查看結果"}
        </button>
      )}
    </div>
  );
}
