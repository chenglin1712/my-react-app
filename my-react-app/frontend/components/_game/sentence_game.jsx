import { useEffect } from "react";
import { Link } from "react-router-dom";
import "../../static/css/_game/sentence.css";
import { useGameSession } from "./useGameSession";
import { useGameAudioPlayer } from "./useGameAudioPlayer";
import { useTimedOptionSelect } from "./useTimedOptionSelect";
import { TRIBE_INTRO } from "./sentenceIntro";

const RATING_THRESHOLDS = [
  { min: 80, className: "excellent" },
  { min: 60, className: "good" },
  { min: 40, className: "fair" },
];

function getRatingClass(pct) {
  return RATING_THRESHOLDS.find((r) => pct >= r.min)?.className ?? "poor";
}

function SentenceGame({ tribe = "tayal" }) {
  const config = TRIBE_INTRO[tribe] || TRIBE_INTRO.tayal;
  const audioBaseUrl = import.meta.env.VITE_API_SEARCH_AUDIO_URL;

  const {
    status, questions, current, answers, setAnswers, loading, error,
    start, restart, goToNext, progressPct,
    // count 不在這裡寫死——省略時後端用 GameConfig.sentence_questions_per_round
    // 當預設值（後台可調）。
  } = useGameSession({ endpoint: import.meta.env.VITE_API_SENTENCE_QUESTIONS_URL, tribe });
  const { isPlaying, play: playAudio, stop: stopAudio } = useGameAudioPlayer(audioBaseUrl);

  const q = questions[current];

  const { selected, beginSelection } = useTimedOptionSelect({
    delayMs: 1400,
    onElapsed: () => { stopAudio(); goToNext(); },
    resetKey: `${tribe}:${status}:${current}`,
  });

  const handleStart = () => {
    start();
  };

  const handlePlay = () => {
    if (!q?.audio_id) return;
    playAudio(q.audio_id);
  };

  const handleSelect = (option) => {
    if (!q || !beginSelection(option)) return;
    const isCorrect = option === q.chinese;
    setAnswers((prev) => [
      ...prev,
      { tayal: q.tayal, chinese: q.chinese, userAnswer: option, isCorrect },
    ]);
  };

  const handleRestart = () => {
    restart();
  };

  useEffect(() => {
    stopAudio();
  }, [current, tribe, status, stopAudio]);

  // ── 介紹畫面 ─────────────────────────────────────
  if (status === "intro") {
    return (
      <div className="sent-intro">
        {config.lines.map((line, i) => (
          <p key={i} className="sent-intro-line">{line}</p>
        ))}
        {error && <p className="sent-error" role="alert">{error}</p>}
        <button type="button" className="sent-btn-primary" onClick={handleStart} disabled={loading}>
          {loading ? "載入中..." : "開始"}
        </button>
      </div>
    );
  }

  // ── 遊戲畫面 ─────────────────────────────────────
  if (status === "playing") {
    if (!q || !Array.isArray(q.options)) return null;

    return (
      <div className="sent-game">
        <div
          className="sent-progress"
          role="progressbar"
          aria-label="作答進度"
          aria-valuemin="0"
          aria-valuemax={questions.length}
          aria-valuenow={current + 1}
        >
          <div
            className="sent-progress-bar"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="sent-counter">第 {current + 1} / {questions.length} 題</p>

        <div className="sent-card">
          <p className="sent-sentence">{q.tayal}</p>
          {q.audio_id && (
            <button
              type="button"
              className={`sent-play-btn ${isPlaying ? "playing" : ""}`}
              onClick={handlePlay}
            >
              {isPlaying ? "♪ 播放中..." : "▶ 聽例句發音"}
            </button>
          )}
        </div>

        <p className="sent-question-hint">{config.hint}</p>

        <div className="sent-options">
          {q.options.map((opt) => {
            let cls = "sent-option";
            if (selected !== null) {
              if (opt === q.chinese)     cls += " correct";
              else if (opt === selected) cls += " wrong";
              else                       cls += " dimmed";
            }
            return (
              <button
                type="button"
                key={opt}
                className={cls}
                onClick={() => handleSelect(opt)}
                disabled={selected !== null}
              >
                {opt}
              </button>
            );
          })}
        </div>

        {selected !== null && (
          <p className={`sent-feedback ${selected === q.chinese ? "correct" : "wrong"}`} aria-live="polite">
            {selected === q.chinese
              ? "✅ 答對了！"
              : `❌ 正確答案：${q.chinese}`}
          </p>
        )}
      </div>
    );
  }

  // ── 結果畫面 ─────────────────────────────────────
  if (status === "result") {
    const score = answers.filter((a) => a.isCorrect).length;
    const total = answers.length;
    const pct   = total > 0 ? Math.round((score / total) * 100) : 0;
    const ratingCls = getRatingClass(pct);

    return (
      <div className="sent-result">
        <h2 className="sent-result-title">句型練習結果</h2>

        <div className={`sent-result-score ${ratingCls}`}>
          <span className="sent-result-num">{score}</span>
          <span className="sent-result-denom"> / {total}</span>
          <p className="sent-result-pct">{pct}%</p>
        </div>

        <div className="sent-result-list">
          {answers.map((a, i) => (
            <div key={`${a.tayal}-${i}`} className={`sent-result-row ${a.isCorrect ? "correct" : "wrong"}`}>
              <span className="sent-result-icon">{a.isCorrect ? "✅" : "❌"}</span>
              <div className="sent-result-content">
                <span className="sent-result-tayal">{a.tayal}</span>
                <span className="sent-result-ans">
                  {a.isCorrect
                    ? a.chinese
                    : <><s>{a.userAnswer}</s> → {a.chinese}</>}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="sent-result-actions">
          <Link className="sent-btn-secondary" to="/game/sentence">
            ← 返回遊戲頁面
          </Link>
          <button type="button" className="sent-btn-primary" onClick={handleRestart}>
            再練一次
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default SentenceGame;
