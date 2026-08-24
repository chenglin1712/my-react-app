export default function PlayingScreen({
  progressPct, current, totalQuestions, q, rating,
  onPlayRef, recState, onStartRecording, onStopRecording, onPlayUserAudio, onResetRecState,
  submitting, onSubmit, score, officialScore, error, onNext,
  shareState, onShare,
}) {
  return (
    <div className="pron-game">
      <div
        className="pron-progress"
        role="progressbar"
        aria-label="作答進度"
        aria-valuemin="0"
        aria-valuemax={totalQuestions}
        aria-valuenow={current + 1}
      >
        <div
          className="pron-progress-bar"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <p className="pron-counter">第 {current + 1} / {totalQuestions} 題</p>

      <div className="pron-card">
        <p className="pron-word">{q.word}</p>
        <p className="pron-meaning">{q.correct}</p>
        <button
          type="button"
          className="pron-play-btn"
          onClick={onPlayRef}
          disabled={recState === "recording" || submitting}
        >
          ▶ 聽範本發音
        </button>
      </div>

      <div className="pron-record-area">
        {recState === "idle" && (
          <button type="button" className="pron-mic-btn" onClick={onStartRecording}>
            🎤<span>開始錄音</span>
          </button>
        )}
        {recState === "recording" && (
          <button type="button" className="pron-mic-btn recording" onClick={onStopRecording}>
            ⏹<span>停止錄音</span>
          </button>
        )}
        {(recState === "recorded" || recState === "submitted") && (
          <div className="pron-recorded-actions">
            <button type="button" className="pron-btn-outline" onClick={onPlayUserAudio}>▶ 重聽錄音</button>
            {recState === "recorded" && (
              <>
                <button type="button" className="pron-btn-outline" onClick={onResetRecState}>↺ 重新錄音</button>
                <button type="button" className="pron-btn-primary" onClick={onSubmit} disabled={submitting}>
                  {submitting ? "比對中..." : "送出比對"}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {recState === "submitted" && rating && (
        <div className={`pron-score-box ${rating.cls}`} aria-live="polite">
          <span className="pron-score-num">{score}</span>
          <span className="pron-score-label">分 — {rating.label}</span>
          {officialScore !== null && score !== officialScore && (
            <span className="pron-score-ref">（官方音檔：{officialScore} 分 · 真人音檔優化）</span>
          )}
        </div>
      )}

      {/* 分享是使用者自己決定的動作，不是比對成功就自動發生——上傳後任何
          登入使用者都能在社群示範發音頁面聽到這段錄音。 */}
      {recState === "submitted" && (
        <div className="pron-share-area">
          <button
            type="button"
            className="pron-btn-outline"
            onClick={onShare}
            disabled={shareState === "sharing" || shareState === "shared"}
          >
            {shareState === "shared" ? "已分享 ✓" : shareState === "sharing" ? "分享中..." : "分享錄音到社群"}
          </button>
          <p className="pron-share-hint">分享後，其他使用者可以在社群示範發音頁面聽到這段錄音。</p>
          {shareState === "error" && <p className="pron-error" role="alert">分享失敗，請稍後再試。</p>}
        </div>
      )}

      {error && <p className="pron-error" role="alert">{error}</p>}

      {recState === "submitted" && (
        <button type="button" className="pron-btn-primary pron-next-btn" onClick={onNext}>
          {current + 1 < totalQuestions ? "下一題 →" : "查看結果"}
        </button>
      )}
    </div>
  );
}
