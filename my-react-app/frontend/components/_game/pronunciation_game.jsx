import { useEffect, useRef, useState } from "react";
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

const MAX_RECORDING_BYTES = 10 * 1024 * 1024;

// 三個門檻值的預設值只在後端還沒回應過任何一次比對結果時當 fallback 用
// （見下方 thresholds state）；一旦後端回過 rating_thresholds，就一律用
// 後端當下的設定值，不再依賴這裡寫死的數字。
const DEFAULT_RATING_THRESHOLDS = { excellent: 80, good: 60, fair: 40 };

function getRating(score, thresholds = DEFAULT_RATING_THRESHOLDS) {
  if (score >= thresholds.excellent) return { label: "優秀", cls: "excellent" };
  if (score >= thresholds.good) return { label: "不錯", cls: "good" };
  if (score >= thresholds.fair) return { label: "繼續加油", cls: "fair" };
  return { label: "再試試", cls: "poor" };
}

function PronunciationGame({ tribe = "tayal" }) {
  const { userData } = useAuth();
  const config = TRIBE_INTRO[tribe] || TRIBE_INTRO.tayal;
  const audioBaseUrl = import.meta.env.VITE_API_SEARCH_AUDIO_URL;

  const {
    status, questions, current, answers, setAnswers, loading, error, setError,
    start, restart, goToNext, progressPct,
  } = useGameSession({ endpoint: import.meta.env.VITE_API_LISTENING_QUESTIONS_URL, tribe, count: 5 });
  const { play: playRefAudio, stop: stopRefAudio } = useGameAudioPlayer(audioBaseUrl);

  const {
    recState, audioBlob,
    reset: resetRecording, start: startRecording, stop: stopRecording, playUserAudio, markSubmitted,
  } = useAudioRecorder(setError);
  const [score, setScore] = useState(null);
  const [officialScore, setOfficialScore] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [thresholds, setThresholds] = useState(DEFAULT_RATING_THRESHOLDS);
  // 分享錄音到社群示範發音頁面是使用者自己決定的動作，不是比對成功就自動
  // 發生——上傳後任何登入的使用者都能在 /game/pronunciation/{tribe}/community
  // 聽到這段錄音，需要使用者明確同意才能做這件事。
  const [shareState, setShareState] = useState("idle"); // idle | sharing | shared | error

  const submissionGenerationRef = useRef(0);
  const advancingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const resetRecState = () => {
    resetRecording();
    setScore(null);
    setOfficialScore(null);
    setShareState("idle");
  };

  const handleStart = async () => {
    submissionGenerationRef.current += 1; // 讓上一輪還沒回來的比對結果失效
    setThresholds(DEFAULT_RATING_THRESHOLDS);
    const ok = await start();
    if (ok) resetRecState();
  };

  const handlePlayRef = () => {
    if (!questions[current]) return;
    playRefAudio(questions[current].audio_id);
  };

  const submitAudio = async () => {
    if (!audioBlob) return;
    if (audioBlob.size > MAX_RECORDING_BYTES) {
      setError("錄音檔過大，請重新錄音。");
      return;
    }
    const myGeneration = submissionGenerationRef.current;
    setSubmitting(true);
    setError(null);

    const q = questions[current];

    try {
      // 1. 取真人參考音檔 URL
      const refUrls = await fetchReferenceUrls(tribe, q.word);
      if (myGeneration !== submissionGenerationRef.current || !mountedRef.current) return;

      // 2. 送後端比對
      const formData = new FormData();
      formData.append("user_audio", audioBlob, "speech.webm");
      formData.append("audio_id", q.audio_id);
      if (refUrls.length > 0) {
        formData.append("reference_urls", refUrls.join(","));
      }

      const data = await apiPost(import.meta.env.VITE_API_QUIZ_AUDIO_URL, formData);
      if (myGeneration !== submissionGenerationRef.current || !mountedRef.current) return;

      if (!data.success) {
        console.error("比對失敗:", data.error);
        setError("比對失敗，請稍後再試。");
        setSubmitting(false);
        return;
      }

      const finalScore = Number.isFinite(data.score) ? Math.round(data.score) : null;
      if (finalScore === null) {
        setError("比對結果異常，請稍後再試。");
        setSubmitting(false);
        return;
      }
      const finalOfficialScore = Number.isFinite(data.official_score) ? Math.round(data.official_score) : null;

      setScore(finalScore);
      setOfficialScore(finalOfficialScore);
      if (data.rating_thresholds) {
        setThresholds(data.rating_thresholds);
      }
      markSubmitted();

      setAnswers((prev) => [...prev, {
        word: q.word,
        meaning: q.correct,
        score: finalScore,
        officialScore: finalOfficialScore,
        usedRef: data.ref_score != null,
      }]);
    } catch (err) {
      if (myGeneration !== submissionGenerationRef.current || !mountedRef.current) return;
      console.error("比對請求失敗:", err.message);
      setError("比對失敗，請稍後再試。");
    } finally {
      if (myGeneration === submissionGenerationRef.current && mountedRef.current) {
        setSubmitting(false);
      }
    }
  };

  const handleShare = async () => {
    if (!audioBlob || shareState === "sharing" || shareState === "shared") return;
    // 分享會把錄音寫成任何登入使用者都能聽到的公開資料，沒有真正的登入
    // 身分就不分享，不要讓錄音掛在一個假的「anonymous」身分底下。
    if (!userData?.uid) {
      setShareState("error");
      return;
    }

    setShareState("sharing");
    const q = questions[current];
    try {
      const storageUrl = await uploadRecording(tribe, q.word, userData.uid, audioBlob);
      await saveRecordingMeta(tribe, q.word, userData.uid, score, storageUrl);
      if (!mountedRef.current) return;
      setShareState("shared");
    } catch (err) {
      console.error("分享錄音失敗:", err.message);
      if (!mountedRef.current) return;
      setShareState("error");
    }
  };

  const handleNext = () => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    stopRefAudio();
    resetRecState();
    goToNext();
  };

  const handleRestart = () => {
    submissionGenerationRef.current += 1;
    setThresholds(DEFAULT_RATING_THRESHOLDS);
    restart();
    resetRecState();
  };

  useEffect(() => {
    stopRefAudio();
  }, [current, tribe, status, stopRefAudio]);

  // 換題之後才解除「下一題」的連點鎖，避免同一題被 goToNext() 呼叫兩次
  // （非最後一題時用的是相對遞增，兩次呼叫會直接跳過一題）。
  useEffect(() => {
    advancingRef.current = false;
  }, [current]);

  if (status === "intro") {
    return <IntroScreen config={config} error={error} loading={loading} onStart={handleStart} tribe={tribe} />;
  }

  if (status === "playing") {
    if (!questions.length) return null;
    const q = questions[current];
    const rating = score !== null ? getRating(score, thresholds) : null;

    return (
      <PlayingScreen
        progressPct={progressPct}
        current={current}
        totalQuestions={questions.length}
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
        shareState={shareState}
        onShare={handleShare}
      />
    );
  }

  if (status === "result") {
    const avg = answers.length
      ? Math.round(answers.reduce((s, a) => s + a.score, 0) / answers.length)
      : 0;
    const avgRating = getRating(avg, thresholds);

    return (
      <ResultScreen
        avg={avg}
        avgRating={avgRating}
        answers={answers}
        thresholds={thresholds}
        getRating={getRating}
        backTo="/game/pronunciation"
        onRestart={handleRestart}
      />
    );
  }

  return null;
}

export default PronunciationGame;
