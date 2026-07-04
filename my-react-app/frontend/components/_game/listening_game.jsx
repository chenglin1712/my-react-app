import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "../../static/css/_game/listening.css";
import { auth } from "../../../firebase";

const TRIBE_INTRO = {
  tayal: {
    title: "Misaniq ATAYAL - 泰雅聽力",
    lines: [
      "歡迎來到《Misaniq ATAYAL - 泰雅聽力》的世界！",
      "泰雅族的語言如山泉般清澈，如風聲般悠遠",
      "聆聽每一個族語詞彙，感受祖先聲音的溫度",
      "這個遊戲將考驗你的耳朵，讓你學會用「聽」來認識族語",
      "每題播放一段泰雅語發音，從四個選項中選出正確的中文意思",
      "準備好你的耳朵，跟著我們一起，聆聽泰雅族語的美麗！",
    ],
  },
  amis: {
    title: "Misaniq PANGCAH - 阿美族語聽力",
    lines: [
      "歡迎來到《Misaniq PANGCAH - 阿美族語聽力》的世界！",
      "阿美族是台灣最大的原住民族，族語活潑而富有節奏",
      "每一個阿美語詞彙，都承載著海洋與土地的記憶",
      "這個遊戲將考驗你的耳朵，讓你學會用「聽」來認識族語",
      "每題播放一段阿美語發音，從四個選項中選出正確的中文意思",
      "準備好你的耳朵，跟著我們一起，聆聽阿美族語的旋律！",
    ],
  },
  bunun: {
    title: "Misaniq BUNUN - 布農族語聽力",
    lines: [
      "歡迎來到《Misaniq BUNUN - 布農族語聽力》的世界！",
      "布農族居住於中央山脈，以八部合音聞名於世",
      "每一個布農語詞彙，都蘊含著山林間深厚的智慧",
      "這個遊戲將考驗你的耳朵，讓你學會用「聽」來認識族語",
      "每題播放一段布農語發音，從四個選項中選出正確的中文意思",
      "準備好你的耳朵，跟著我們一起，聆聽布農族語的力量！",
    ],
  },
  kavalan: {
    title: "Misaniq KAVALAN - 葛瑪蘭族語聽力",
    lines: [
      "歡迎來到《Misaniq KAVALAN - 葛瑪蘭族語聽力》的世界！",
      "葛瑪蘭族是蘭陽平原的守護者，族語悠揚而細膩",
      "每一個葛瑪蘭語詞彙，都流淌著海洋與稻田的氣息",
      "這個遊戲將考驗你的耳朵，讓你學會用「聽」來認識族語",
      "每題播放一段葛瑪蘭語發音，從四個選項中選出正確的中文意思",
      "準備好你的耳朵，跟著我們一起，聆聽葛瑪蘭族語的溫柔！",
    ],
  },
  paiwan: {
    title: "Misaniq PAIWAN - 排灣族語聽力",
    lines: [
      "歡迎來到《Misaniq PAIWAN - 排灣族語聽力》的世界！",
      "排灣族以精湛的雕刻與琉璃珠藝術聞名，族語典雅而深邃",
      "每一個排灣語詞彙，都承載著祖靈的智慧與百步蛇的傳說",
      "這個遊戲將考驗你的耳朵，讓你學會用「聽」來認識族語",
      "每題播放一段排灣語發音，從四個選項中選出正確的中文意思",
      "準備好你的耳朵，跟著我們一起，聆聽排灣族語的驕傲！",
    ],
  },
};

function ListeningGame({ tribe = "tayal" }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState("intro");   // intro | playing | result
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState(null);   // 使用者選的答案
  const [answers, setAnswers] = useState([]);        // 每題結果紀錄
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef(null);

  const config = TRIBE_INTRO[tribe] || TRIBE_INTRO.tayal;
  const audioBaseUrl = import.meta.env.VITE_API_SEARCH_AUDIO_URL || "/dictionary/audio/";

  // 載入題目，成功回傳題目陣列，失敗回傳 null
  const fetchQuestions = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await axios.get(`/listening/questions?tribe=${tribe}&count=10`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setQuestions(res.data.questions);
      return res.data.questions;
    } catch (e) {
      setError("題目載入失敗，請確認後端伺服器是否啟動。");
      return null;
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    const qs = await fetchQuestions();
    if (!qs || qs.length === 0) return;  // 失敗則停在介紹畫面
    setCurrent(0);
    setAnswers([]);
    setSelected(null);
    setStatus("playing");
  };

  // 播放音頻
  const handlePlay = () => {
    if (!questions[current]) return;
    const url = audioBaseUrl + questions[current].audio_id;
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onplay  = () => setIsPlaying(true);
    audio.onended = () => setIsPlaying(false);
    audio.onerror = () => setIsPlaying(false);
    audio.play().catch(() => setIsPlaying(false));
  };

  // 選擇答案
  const handleSelect = (option) => {
    if (selected !== null) return;   // 已選過，不重複
    setSelected(option);
    const isCorrect = option === questions[current].correct;
    const record = {
      word: questions[current].word,
      correct: questions[current].correct,
      userAnswer: option,
      isCorrect,
    };

    const newAnswers = [...answers, record];
    setAnswers(newAnswers);

    // 1.4 秒後進入下一題或結果
    setTimeout(() => {
      if (current + 1 < questions.length) {
        setCurrent(c => c + 1);
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

  // 切換題目時停止音頻
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, [current]);

  // ── 介紹畫面 ───────────────────────────────────────
  if (status === "intro") {
    return (
      <div className="listening-intro">
        {config.lines.map((line, i) => (
          <p key={i} className="listening-intro-line">{line}</p>
        ))}
        {error && <p className="listening-error">{error}</p>}
        <button
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
    if (!questions.length) return null;
    const q = questions[current];

    return (
      <div className="listening-game">
        {/* 進度列 */}
        <div className="listening-progress">
          <div
            className="listening-progress-bar"
            style={{ width: `${((current + 1) / questions.length) * 100}%` }}
          />
        </div>
        <p className="listening-counter">第 {current + 1} / {questions.length} 題</p>

        {/* 播放區 */}
        <div className="listening-play-area">
          <button
            className={`listening-play-btn ${isPlaying ? "playing" : ""}`}
            onClick={handlePlay}
            title="播放音頻"
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
          <p className="listening-reveal">
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
    const pct   = Math.round((score / total) * 100);

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
              key={i}
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
          <button className="listening-btn-secondary" onClick={() => navigate("/game/listening")}>
            ← 返回遊戲頁面
          </button>
          <button className="listening-btn-primary" onClick={handleRestart}>
            再玩一次
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default ListeningGame;
