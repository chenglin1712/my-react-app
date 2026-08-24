import { useEffect } from "react";
import { Link } from "react-router-dom";
import "../../static/css/_game/listening.css";
import { useGameSession } from "./useGameSession";
import { useGameAudioPlayer } from "./useGameAudioPlayer";
import { useTimedOptionSelect } from "./useTimedOptionSelect";
import { TRIBE_INTRO } from "./listeningIntro";

function ListeningGame({ tribe = "tayal" }) {
  const config = TRIBE_INTRO[tribe] || TRIBE_INTRO.tayal;
  const audioBaseUrl = import.meta.env.VITE_API_SEARCH_AUDIO_URL;

  const {
    status, questions, current, answers, setAnswers, loading, error,
    start, restart, goToNext, progressPct,
    // count 不在這裡寫死——省略時後端用 GameConfig.listening_questions_per_round
    // 當預設值（後台可調），跟 pronunciation_game.jsx 刻意固定傳 count=5 不同：
    // 那邊是借用同一個出題端點的詞彙池，但發音練習每輪題數是獨立的遊戲設計，
    // 不該被「聽力遊戲每輪題數」這個設定連動改變。
  } = useGameSession({ endpoint: import.meta.env.VITE_API_LISTENING_QUESTIONS_URL, tribe });
  const { isPlaying, play: playAudio, stop: stopAudio } = useGameAudioPlayer(audioBaseUrl);

  const q = questions[current];

  const { selected, beginSelection } = useTimedOptionSelect({
    delayMs: 1400,
    onElapsed: () => { stopAudio(); goToNext(); },
    // 換題、切換族語、重新開始都代表「這是全新的一次選擇」，殘留的
    // selected/計時器都該一併清掉，不用在 handleRestart 另外手動處理。
    resetKey: `${tribe}:${status}:${current}`,
  });

  const handleStart = () => {
    start();
  };

  // 播放音頻
  const handlePlay = () => {
    if (!q) return;
    playAudio(q.audio_id);
  };

  // 選擇答案
  const handleSelect = (option) => {
    if (!q || !beginSelection(option)) return; // 已選過，不重複
    const isCorrect = option === q.correct;
    setAnswers((prev) => [...prev, {
      word: q.word,
      correct: q.correct,
      userAnswer: option,
      isCorrect,
    }]);
  };

  const handleRestart = () => {
    restart();
  };

  // 切換題目、族語或畫面狀態時都要停止播放——原本只看 current，同一個
  // index 但換了族語/重新開始時不會觸發停止。
  useEffect(() => {
    stopAudio();
  }, [current, tribe, status, stopAudio]);

  // ── 介紹畫面 ───────────────────────────────────────
  if (status === "intro") {
    return (
      <div className="listening-intro">
        {config.lines.map((line, i) => (
          <p key={i} className="listening-intro-line">{line}</p>
        ))}
        {error && <p className="listening-error" role="alert">{error}</p>}
        <button
          type="button"
          className="listening-btn-primary"
          onClick={handleStart}
          disabled={loading}
        >
          {loading ? "載入中..." : "開始"}
        </button>
      </div>
    );
  }

  // ── 遊戲畫面 ───────────────────────────────────────
  if (status === "playing") {
    if (!q || !Array.isArray(q.options)) return null;

    return (
      <div className="listening-game">
        {/* 進度列 */}
        <div
          className="listening-progress"
          role="progressbar"
          aria-label="作答進度"
          aria-valuemin="0"
          aria-valuemax={questions.length}
          aria-valuenow={current + 1}
        >
          <div
            className="listening-progress-bar"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="listening-counter">第 {current + 1} / {questions.length} 題</p>

        {/* 播放區 */}
        <div className="listening-play-area">
          <button
            type="button"
            className={`listening-play-btn ${isPlaying ? "playing" : ""}`}
            onClick={handlePlay}
            title="播放音頻"
            aria-label={isPlaying ? "播放中" : "播放發音"}
          >
            {isPlaying ? "♪" : "▶"}
          </button>
          <p className="listening-play-hint">
            {isPlaying ? "播放中..." : "點擊播放發音"}
          </p>
        </div>

        {/* 答案選項 */}
        <div className="listening-options">
          {q.options.map((opt) => {
            let cls = "listening-option";
            if (selected !== null) {
              if (opt === q.correct)       cls += " correct";
              else if (opt === selected)   cls += " wrong";
              else                         cls += " dimmed";
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

        {/* 選完後顯示單字 */}
        {selected !== null && (
          <p className="listening-reveal" aria-live="polite">
            族語：<strong>{q.word}</strong>
          </p>
        )}
      </div>
    );
  }

  // ── 結果畫面 ───────────────────────────────────────
  if (status === "result") {
    const score = answers.filter(a => a.isCorrect).length;
    const total = answers.length;
    const pct   = total > 0 ? Math.round((score / total) * 100) : 0;

    return (
      <div className="listening-result">
        <h2 className="listening-result-title">遊戲結果</h2>

        <div className="listening-result-score">
          <span className="listening-result-num">{score}</span>
          <span className="listening-result-denom"> / {total}</span>
          <p className="listening-result-pct">{pct}%</p>
        </div>

        <div className="listening-result-list">
          {answers.map((a, i) => (
            <div
              key={`${a.word}-${i}`}
              className={`listening-result-row ${a.isCorrect ? "correct" : "wrong"}`}
            >
              <span className="listening-result-icon">{a.isCorrect ? "✅" : "❌"}</span>
              <span className="listening-result-word">{a.word}</span>
              <span className="listening-result-ans">
                {a.isCorrect
                  ? a.correct
                  : <><s>{a.userAnswer}</s> → {a.correct}</>
                }
              </span>
            </div>
          ))}
        </div>

        <div className="listening-result-actions">
          <Link className="listening-btn-secondary" to="/game/listening">
            ← 返回遊戲頁面
          </Link>
          <button type="button" className="listening-btn-primary" onClick={handleRestart}>
            再玩一次
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default ListeningGame;
