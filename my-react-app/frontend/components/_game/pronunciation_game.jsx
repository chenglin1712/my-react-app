import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../src/userServives/authContext";
import { useGameSession } from "./useGameSession";
import { useGameAudioPlayer } from "./useGameAudioPlayer";
import { apiPost } from "../../utils/apiClient";
import { TRIBE_INTRO } from "./pronunciation/pronunciationIntro";
import { fetchReferenceUrls, uploadRecording, saveRecordingMeta } from "./pronunciation/pronunciationRecordingService";
import { useAudioRecorder } from "./pronunciation/useAudioRecorder";
import IntroScreen from "./pronunciation/IntroScreen";
import PlayingScreen from "./pronunciation/PlayingScreen";
import ResultScreen from "./pronunciation/ResultScreen";
import "../../static/css/_game/pronunciation.css";

const RATING = (score) => {
  if (score >= 80) return { label: "優秀", cls: "excellent" };
  if (score >= 60) return { label: "不錯", cls: "good" };
  if (score >= 40) return { label: "繼續加油", cls: "fair" };
  return { label: "再試試", cls: "poor" };
};

function PronunciationGame({ tribe = "tayal" }) {
  const navigate = useNavigate();
  const { userData } = useAuth();
  const config = TRIBE_INTRO[tribe] || TRIBE_INTRO.tayal;
  const audioBaseUrl = import.meta.env.VITE_API_SEARCH_AUDIO_URL;

  const {
    status, questions, current, answers, setAnswers, loading, error, setError,
    start, restart, goToNext, progressPct,
  } = useGameSession({ endpoint: import.meta.env.VITE_API_LISTENING_QUESTIONS_URL, tribe, count: 5 });
  const { play: playRefAudio, stop: stopRefAudio } = useGameAudioPlayer(audioBaseUrl);

  const {
    recState, setRecState, audioBlob,
    reset: resetRecording, start: startRecording, stop: stopRecording, playUserAudio,
  } = useAudioRecorder(setError);
  const [score, setScore] = useState(null);
  const [officialScore, setOfficialScore] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const resetRecState = () => {
    resetRecording();
    setScore(null);
    setOfficialScore(null);
  };

  const handleStart = async () => {
    const ok = await start();
    if (ok) resetRecState();
  };

  const handlePlayRef = () => {
    if (!questions[current]) return;
    playRefAudio(questions[current].audio_id);
  };

  const submitAudio = async () => {
    if (!audioBlob) return;
    if (audioBlob.size > 10 * 1024 * 1024) {
      setError("錄音檔過大，請重新錄音。");
      return;
    }
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

      const data = await apiPost(import.meta.env.VITE_API_QUIZ_AUDIO_URL, formData);

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
    stopRefAudio();
    resetRecState();
    goToNext();
  };

  const handleRestart = () => {
    restart();
    resetRecState();
  };

  useEffect(() => {
    stopRefAudio();
  }, [current, stopRefAudio]);

  if (status === "intro") {
    return <IntroScreen config={config} error={error} loading={loading} onStart={handleStart} />;
  }

  if (status === "playing") {
    if (!questions.length) return null;
    const q = questions[current];
    const rating = score !== null ? RATING(score) : null;

    return (
      <PlayingScreen
        progressPct={progressPct}
        current={current}
        questions={questions}
        q={q}
        rating={rating}
        onPlayRef={handlePlayRef}
        recState={recState}
        onStartRecording={startRecording}
        onStopRecording={stopRecording}
        onPlayUserAudio={playUserAudio}
        onResetRecState={resetRecState}
        submitting={submitting}
        onSubmit={submitAudio}
        score={score}
        officialScore={officialScore}
        error={error}
        onNext={handleNext}
      />
    );
  }

  if (status === "result") {
    const avg = answers.length
      ? Math.round(answers.reduce((s, a) => s + a.score, 0) / answers.length)
      : 0;
    const avgRating = RATING(avg);

    return (
      <ResultScreen
        avg={avg}
        avgRating={avgRating}
        answers={answers}
        ratingOf={RATING}
        onBack={() => navigate("/game/pronunciation")}
        onRestart={handleRestart}
      />
    );
  }

  return null;
}

export default PronunciationGame;
