import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import {
  collection, addDoc, getDocs, query,
  where, orderBy, limit, serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../../firebase";
import { useAuth } from "../../src/userServives/authContext";
import "../../static/css/_game/pronunciation.css";

const TRIBE_INTRO = {
  tayal: {
    lines: [
      "歡迎來到《Qmisan ATAYAL - 泰雅發音練習》的世界！",
      "發音是學習族語最重要的第一步",
      "跟著每一題的範本發音，錄下你的聲音送出比對",
      "系統會幫你評分，讓你知道發音有多準確",
      "每次練習 5 個詞彙，反覆練習讓發音更標準",
      "準備好麥克風，跟著我們一起，開口說泰雅！",
    ],
  },
  amis: {
    lines: [
      "歡迎來到《Qmisan PANGCAH - 阿美族語發音練習》的世界！",
      "發音是學習族語最重要的第一步",
      "跟著每一題的範本發音，錄下你的聲音送出比對",
      "系統會幫你評分，讓你知道發音有多準確",
      "每次練習 5 個詞彙，反覆練習讓發音更標準",
      "準備好麥克風，跟著我們一起，開口說阿美語！",
    ],
  },
  bunun: {
    lines: [
      "歡迎來到《Qmisan BUNUN - 布農族語發音練習》的世界！",
      "發音是學習族語最重要的第一步",
      "跟著每一題的範本發音，錄下你的聲音送出比對",
      "系統會幫你評分，讓你知道發音有多準確",
      "每次練習 5 個詞彙，反覆練習讓發音更標準",
      "準備好麥克風，跟著我們一起，開口說布農語！",
    ],
  },
  kavalan: {
    lines: [
      "歡迎來到《Qmisan KAVALAN - 葛瑪蘭族語發音練習》的世界！",
      "發音是學習族語最重要的第一步",
      "跟著每一題的範本發音，錄下你的聲音送出比對",
      "系統會幫你評分，讓你知道發音有多準確",
      "每次練習 5 個詞彙，反覆練習讓發音更標準",
      "準備好麥克風，跟著我們一起，開口說葛瑪蘭語！",
    ],
  },
  paiwan: {
    lines: [
      "歡迎來到《Qmisan PAIWAN - 排灣族語發音練習》的世界！",
      "發音是學習族語最重要的第一步",
      "跟著每一題的範本發音，錄下你的聲音送出比對",
      "系統會幫你評分，讓你知道發音有多準確",
      "每次練習 5 個詞彙，反覆練習讓發音更標準",
      "準備好麥克風，跟著我們一起，開口說排灣語！",
    ],
  },
};

const RATING = (score) => {
  if (score >= 80) return { label: "優秀", cls: "excellent" };
  if (score >= 60) return { label: "不錯", cls: "good" };
  if (score >= 40) return { label: "繼續加油", cls: "fair" };
  return { label: "再試試", cls: "poor" };
};

// ── Firebase 工具 ──────────────────────────────────────────────

// 取得該詞高分真人音檔（score >= 70，最多 5 筆）
async function fetchReferenceUrls(tribe, word) {
  try {
    const q = query(
      collection(db, "pronunciations", tribe, "recordings"),
      where("word", "==", word),
      where("score", ">=", 70),
      orderBy("score", "desc"),
      limit(5),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data().storageUrl).filter(Boolean);
  } catch {
    return [];
  }
}

// 上傳錄音到 Firebase Storage，回傳公開 download URL
async function uploadRecording(tribe, word, uid, blob) {
  const filename = `${Date.now()}_${uid}.webm`;
  const storageRef = ref(storage, `pronunciations/${tribe}/${word}/${filename}`);
  await uploadBytes(storageRef, blob, { contentType: "audio/webm" });
  return await getDownloadURL(storageRef);
}

// 寫 Firestore metadata
async function saveRecordingMeta(tribe, word, uid, score, storageUrl) {
  await addDoc(collection(db, "pronunciations", tribe, "recordings"), {
    word,
    tribe,
    uid,
    score,
    storageUrl,
    createdAt: serverTimestamp(),
  });
}

// ── 主元件 ────────────────────────────────────────────────────

function PronunciationGame({ tribe = "tayal" }) {
  const navigate = useNavigate();
  const { userData } = useAuth();
  const config = TRIBE_INTRO[tribe] || TRIBE_INTRO.tayal;

  const [status, setStatus] = useState("intro");
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [recState, setRecState] = useState("idle");
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [score, setScore] = useState(null);
  const [officialScore, setOfficialScore] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [answers, setAnswers] = useState([]);

  const mediaRecorder = useRef(null);
  const chunks = useRef([]);
  const refAudio = useRef(null);

  const audioBaseUrl = import.meta.env.VITE_API_SEARCH_AUDIO_URL || "/dictionary/audio/";

  const fetchQuestions = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`/listening/questions?tribe=${tribe}&count=5`);
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
    resetRecState();
    setStatus("playing");
  };

  const resetRecState = () => {
    setRecState("idle");
    setAudioBlob(null);
    setAudioUrl(null);
    setScore(null);
    setOfficialScore(null);
  };

  const handlePlayRef = () => {
    if (!questions[current]) return;
    const url = audioBaseUrl + questions[current].audio_id;
    if (refAudio.current) refAudio.current.pause();
    const a = new Audio(url);
    refAudio.current = a;
    a.play().catch(() => {});
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      chunks.current = [];
      mediaRecorder.current.ondataavailable = (e) => chunks.current.push(e.data);
      mediaRecorder.current.onstop = () => {
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setRecState("recorded");
      };
      mediaRecorder.current.start();
      setRecState("recording");
    } catch {
      setError("無法存取麥克風，請確認瀏覽器權限。");
    }
  };

  const stopRecording = () => {
    mediaRecorder.current?.stop();
  };

  const playUserAudio = () => {
    if (audioUrl) new Audio(audioUrl).play();
  };

  const submitAudio = async () => {
    if (!audioBlob) return;
    setSubmitting(true);
    setError(null);

    const q = questions[current];
    const uid = userData?.uid || "anonymous";

    try {
      // 1. 取真人參考音檔 URL
      const refUrls = await fetchReferenceUrls(tribe, q.word);

      // 2. 送後端比對
      const formData = new FormData();
      formData.append("user_audio", audioBlob, "speech.webm");
      formData.append("audio_id", q.audio_id);
      if (refUrls.length > 0) {
        formData.append("reference_urls", refUrls.join(","));
      }

      const res = await fetch(import.meta.env.VITE_API_QUIZ_AUDIO_URL, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!data.success) {
        setError(`比對失敗：${data.error || "未知錯誤"}`);
        setSubmitting(false);
        return;
      }

      const finalScore = Math.round(data.score);
      setScore(finalScore);
      setOfficialScore(data.official_score != null ? Math.round(data.official_score) : null);
      setRecState("submitted");

      // 3. 上傳錄音到 Firebase Storage（背景執行，不阻塞 UI）
      uploadRecording(tribe, q.word, uid, audioBlob)
        .then((storageUrl) => saveRecordingMeta(tribe, q.word, uid, finalScore, storageUrl))
        .catch(() => {}); // 上傳失敗不影響遊戲流程

      setAnswers((prev) => [...prev, {
        word: q.word,
        meaning: q.correct,
        score: finalScore,
        officialScore: data.official_score != null ? Math.round(data.official_score) : null,
        usedRef: data.ref_score != null,
      }]);
    } catch {
      setError("比對失敗，請稍後再試。");
    } finally {
      setSubmitting(false);
    }
  };

  const handleNext = () => {
    if (refAudio.current) refAudio.current.pause();
    if (current + 1 < questions.length) {
      setCurrent((c) => c + 1);
      resetRecState();
    } else {
      setStatus("result");
    }
  };

  const handleRestart = () => {
    setStatus("intro");
    setQuestions([]);
    setCurrent(0);
    setAnswers([]);
    resetRecState();
  };

  useEffect(() => {
    if (refAudio.current) refAudio.current.pause();
  }, [current]);

  // ── 介紹畫面 ──────────────────────────────────
  if (status === "intro") {
    return (
      <div className="pron-intro">
        {config.lines.map((line, i) => (
          <p key={i} className="pron-intro-line">{line}</p>
        ))}
        {error && <p className="pron-error">{error}</p>}
        <button className="pron-btn-primary" onClick={handleStart} disabled={loading}>
          {loading ? "載入中..." : "開始"}
        </button>
      </div>
    );
  }

  // ── 遊戲畫面 ──────────────────────────────────
  if (status === "playing") {
    if (!questions.length) return null;
    const q = questions[current];
    const rating = score !== null ? RATING(score) : null;

    return (
      <div className="pron-game">
        <div className="pron-progress">
          <div
            className="pron-progress-bar"
            style={{ width: `${((current + 1) / questions.length) * 100}%` }}
          />
        </div>
        <p className="pron-counter">第 {current + 1} / {questions.length} 題</p>

        <div className="pron-card">
          <p className="pron-word">{q.word}</p>
          <p className="pron-meaning">{q.correct}</p>
          <button className="pron-play-btn" onClick={handlePlayRef}>
            ▶ 聽範本發音
          </button>
        </div>

        <div className="pron-record-area">
          {recState === "idle" && (
            <button className="pron-mic-btn" onClick={startRecording}>
              🎤<span>開始錄音</span>
            </button>
          )}
          {recState === "recording" && (
            <button className="pron-mic-btn recording" onClick={stopRecording}>
              ⏹<span>停止錄音</span>
            </button>
          )}
          {(recState === "recorded" || recState === "submitted") && (
            <div className="pron-recorded-actions">
              <button className="pron-btn-outline" onClick={playUserAudio}>▶ 重聽錄音</button>
              {recState === "recorded" && (
                <>
                  <button className="pron-btn-outline" onClick={resetRecState}>↺ 重新錄音</button>
                  <button className="pron-btn-primary" onClick={submitAudio} disabled={submitting}>
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
          <button className="pron-btn-primary pron-next-btn" onClick={handleNext}>
            {current + 1 < questions.length ? "下一題 →" : "查看結果"}
          </button>
        )}
      </div>
    );
  }

  // ── 結果畫面 ──────────────────────────────────
  if (status === "result") {
    const avg = answers.length
      ? Math.round(answers.reduce((s, a) => s + a.score, 0) / answers.length)
      : 0;
    const avgRating = RATING(avg);

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
            const r = RATING(a.score);
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
          <button className="pron-btn-secondary" onClick={() => navigate("/game/pronunciation")}>
            ← 返回遊戲頁面
          </button>
          <button className="pron-btn-primary" onClick={handleRestart}>
            再練一次
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default PronunciationGame;
