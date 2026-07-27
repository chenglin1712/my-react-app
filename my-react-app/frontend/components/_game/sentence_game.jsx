import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "../../static/css/_game/sentence.css";
import { useGameSession } from "./useGameSession";
import { useGameAudioPlayer } from "./useGameAudioPlayer";

const TRIBE_INTRO = {
  tayal: {
    hint: "這句泰雅語的意思是？",
    lines: [
      "歡迎來到《Lmuhuw ATAYAL - 泰雅句型練習》的世界！",
      "泰雅族語中，句型是連接詞彙與文化表達的橋樑",
      "每一道題目展示一個泰雅語例句，請選出正確的中文意思",
      "學習常見句型，讓你更自然地理解並開口說族語",
      "每次練習 5 個句型，由淺入深，循序漸進",
      "準備好了嗎？跟著我們一起，感受泰雅語的句子之美！",
    ],
  },
  amis: {
    hint: "這句阿美語的意思是？",
    lines: [
      "歡迎來到《Lmuhuw AMIS - 阿美句型練習》的世界！",
      "阿美族語是台灣原住民族中使用人口最多的語言",
      "每一道題目展示一個阿美語例句，請選出正確的中文意思",
      "學習常見句型，讓你更自然地理解並開口說族語",
      "每次練習 5 個句型，由淺入深，循序漸進",
      "準備好了嗎？跟著我們一起，感受阿美語的句子之美！",
    ],
  },
  bunun: {
    hint: "這句布農語的意思是？",
    lines: [
      "歡迎來到《Lmuhuw BUNUN - 布農句型練習》的世界！",
      "布農族語以複雜的動詞焦點系統聞名於語言學界",
      "每一道題目展示一個布農語例句，請選出正確的中文意思",
      "學習常見句型，讓你更自然地理解並開口說族語",
      "每次練習 5 個句型，由淺入深，循序漸進",
      "準備好了嗎？跟著我們一起，感受布農語的句子之美！",
    ],
  },
  kavalan: {
    hint: "這句噶瑪蘭語的意思是？",
    lines: [
      "歡迎來到《Lmuhuw KAVALAN - 噶瑪蘭句型練習》的世界！",
      "噶瑪蘭族語是台灣瀕危語言之一，值得我們共同守護",
      "每一道題目展示一個噶瑪蘭語例句，請選出正確的中文意思",
      "學習常見句型，讓你更自然地理解並開口說族語",
      "每次練習 5 個句型，由淺入深，循序漸進",
      "準備好了嗎？跟著我們一起，感受噶瑪蘭語的句子之美！",
    ],
  },
  paiwan: {
    hint: "這句排灣語的意思是？",
    lines: [
      "歡迎來到《Lmuhuw PAIWAN - 排灣句型練習》的世界！",
      "排灣族語擁有豐富的敬語系統，反映族群獨特的階層文化",
      "每一道題目展示一個排灣語例句，請選出正確的中文意思",
      "學習常見句型，讓你更自然地理解並開口說族語",
      "每次練習 5 個句型，由淺入深，循序漸進",
      "準備好了嗎？跟著我們一起，感受排灣語的句子之美！",
    ],
  },
};

function SentenceGame({ tribe = "tayal" }) {
  const navigate = useNavigate();
  const config = TRIBE_INTRO[tribe] || TRIBE_INTRO.tayal;
  const audioBaseUrl = import.meta.env.VITE_API_SEARCH_AUDIO_URL;

  const {
    status, questions, current, answers, setAnswers, loading, error,
    start, restart, goToNext, progressPct,
  } = useGameSession({ endpoint: import.meta.env.VITE_API_SENTENCE_QUESTIONS_URL, tribe, count: 5 });
  const { isPlaying, play: playAudio, stop: stopAudio } = useGameAudioPlayer(audioBaseUrl);

  const [selected, setSelected] = useState(null);

  const handleStart = async () => {
    const ok = await start();
    if (ok) setSelected(null);
  };

  const handlePlay = () => {
    const q = questions[current];
    playAudio(q?.audio_id);
  };

  const handleSelect = (option) => {
    if (selected !== null) return;
    setSelected(option);
    const q = questions[current];
    const isCorrect = option === q.chinese;
    setAnswers((prev) => [
      ...prev,
      { tayal: q.tayal, chinese: q.chinese, userAnswer: option, isCorrect },
    ]);

    setTimeout(() => {
      setSelected(null);
      stopAudio();
      goToNext();
    }, 1400);
  };

  const handleRestart = () => {
    restart();
    setSelected(null);
  };

  useEffect(() => {
    stopAudio();
  }, [current, stopAudio]);

  // ── 介紹畫面 ─────────────────────────────────────
  if (status === "intro") {
    return (
      <div className="sent-intro">
        {config.lines.map((line, i) => (
          <p key={i} className="sent-intro-line">{line}</p>
        ))}
        {error && <p className="sent-error">{error}</p>}
        <button className="sent-btn-primary" onClick={handleStart} disabled={loading}>
          {loading ? "載入中..." : "開始"}
        </button>
      </div>
    );
  }

  // ── 遊戲畫面 ─────────────────────────────────────
  if (status === "playing") {
    if (!questions.length) return null;
    const q = questions[current];

    return (
      <div className="sent-game">
        <div className="sent-progress">
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
          <p className={`sent-feedback ${selected === q.chinese ? "correct" : "wrong"}`}>
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
    const ratingCls =
      pct >= 80 ? "excellent" : pct >= 60 ? "good" : pct >= 40 ? "fair" : "poor";

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
            <div key={i} className={`sent-result-row ${a.isCorrect ? "correct" : "wrong"}`}>
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
          <button
            className="sent-btn-secondary"
            onClick={() => navigate("/game/sentence")}
          >
            ← 返回遊戲頁面
          </button>
          <button className="sent-btn-primary" onClick={handleRestart}>
            再練一次
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default SentenceGame;
