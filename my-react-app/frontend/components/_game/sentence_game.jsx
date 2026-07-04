import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "../../static/css/_game/sentence.css";
import { auth } from "../../../firebase";
import { createAuthorizedAudio } from "../../utils/authAudio";

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
    hint: "這句葛瑪蘭語的意思是？",
    lines: [
      "歡迎來到《Lmuhuw KAVALAN - 葛瑪蘭句型練習》的世界！",
      "葛瑪蘭族語是台灣瀕危語言之一，值得我們共同守護",
      "每一道題目展示一個葛瑪蘭語例句，請選出正確的中文意思",
      "學習常見句型，讓你更自然地理解並開口說族語",
      "每次練習 5 個句型，由淺入深，循序漸進",
      "準備好了嗎？跟著我們一起，感受葛瑪蘭語的句子之美！",
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

  const [status, setStatus] = useState("intro");
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef(null);

  const audioBaseUrl = import.meta.env.VITE_API_SEARCH_AUDIO_URL || "/dictionary/audio/";

  const fetchQuestions = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await axios.get(`/sentence/questions?tribe=${tribe}&count=5`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setQuestions(res.data.questions);
      return res.data.questions;
    } catch {
      setError("題目載入失敗，請確認後端伺服器是否啟動。");
      return null;
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    const qs = await fetchQuestions();
    if (!qs || qs.length === 0) return;
    setCurrent(0);
    setAnswers([]);
    setSelected(null);
    setStatus("playing");
  };

  const handlePlay = async () => {
    const q = questions[current];
    if (!q?.audio_id) return;
    const url = audioBaseUrl + q.audio_id;
    if (audioRef.current) audioRef.current.pause();
    let audio;
    try {
      audio = await createAuthorizedAudio(url);
    } catch {
      setIsPlaying(false);
      return;
    }
    audioRef.current = audio;
    audio.onplay  = () => setIsPlaying(true);
    audio.onended = () => setIsPlaying(false);
    audio.onerror = () => setIsPlaying(false);
    audio.play().catch(() => setIsPlaying(false));
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
      if (current + 1 < questions.length) {
        setCurrent((c) => c + 1);
        setSelected(null);
        setIsPlaying(false);
      } else {
        setStatus("result");
      }
    }, 1400);
  };

  const handleRestart = () => {
    setStatus("intro");
    setQuestions([]);
    setCurrent(0);
    setSelected(null);
    setAnswers([]);
  };

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, [current]);

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
            style={{ width: `${((current + 1) / questions.length) * 100}%` }}
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
    const pct   = Math.round((score / total) * 100);
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
