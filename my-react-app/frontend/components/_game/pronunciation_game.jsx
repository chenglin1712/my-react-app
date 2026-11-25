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
import { apiUrl } from "../../utils/apiUrls";

const MAX_RECORDING_BYTES = 10 * 1024 * 1024;

// 缺 word 或 audio_id 的題目沒辦法玩（稽核 FE5-17）
const isValidQuestion = (q) => Boolean(q) && typeof q.word === "string" && q.word !== "" && Boolean(q.audio_id);

// 後端這幾個步驟的訊息已在地化、不含內部細節，而且是使用者可以照著做的（重錄、檔案過大）；
// 一律顯示「請稍後再試」會讓人重送同一個檔案一直失敗（稽核 FE5-08）。
const ACTIONABLE_ERROR_STEPS = new Set([
  "file_too_large", "read_user_audio", "convert_user_to_wav", "user_embedding",
]);

function compareFailureMessage(data) {
  if (ACTIONABLE_ERROR_STEPS.has(data?.error_step) && typeof data?.error === "string" && data.error) {
    return `比對失敗：${data.error}`;
  }
  return "比對失敗，請稍後再試。";
}

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
  const audioBaseUrl = apiUrl('SEARCH_AUDIO');

  const {
    status, questions, current, answers, setAnswers, loading, error, setError,
    start, restart, goToNext, progressPct,
  } = useGameSession({ endpoint: apiUrl('LISTENING_QUESTIONS'), tribe, count: 5, isValidQuestion });
  const { play: playRefAudio, stop: stopRefAudio } = useGameAudioPlayer(audioBaseUrl);

  const {
    recState, audioBlob,
    reset: resetRecording, start: startRecording, stop: stopRecording, playUserAudio, stopUserAudio, markSubmitted,
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
  // 分享的「世代」：換題或重錄後，上一題還沒回來的分享結果不能蓋到新題的狀態上（稽核 FE5-02）
  const shareGenerationRef = useRef(0);
  // 已經上傳成功、但 Firestore 紀錄寫入失敗的錄音：重試時只補寫紀錄，不再多上傳一份孤兒檔（稽核 FE5-12）
  const uploadedRecordingRef = useRef(null); // { blob, storageUrl }

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const resetRecState = () => {
    resetRecording();
    setScore(null);
    setOfficialScore(null);
    setShareState("idle");
    shareGenerationRef.current += 1;
    uploadedRecordingRef.current = null;
    // 比對還在進行時按「重新錄音」：讓舊請求失效，否則它回來後會把舊錄音的分數套到新錄音上
    submissionGenerationRef.current += 1;
    setSubmitting(false);
    setError(null); // 稽核 FE5-11：重錄、換題時清掉上一輪的錯誤訊息
  };

  const handleStart = async () => {
    submissionGenerationRef.current += 1; // 讓上一輪還沒回來的比對結果失效
    setThresholds(DEFAULT_RATING_THRESHOLDS);
    const ok = await start();
    if (ok) resetRecState();
  };

  const handlePlayRef = () => {
    if (!questions[current]) return;
    stopUserAudio(); // 兩種播放互斥（稽核 FE5-10）
    playRefAudio(questions[current].audio_id);
  };

  // 開始錄音前要先停掉範本音檔，否則外放時範本會被錄進去、影響比對分數（稽核 FE5-10）
  const handleStartRecording = () => {
    stopRefAudio();
    stopUserAudio();
    startRecording();
  };

  const handlePlayUserAudio = () => {
    stopRefAudio();
    playUserAudio();
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
      formData.append("user_audio", audioBlob, audioBlob.type.includes("mp4") ? "speech.m4a" : "speech.webm");
      formData.append("audio_id", q.audio_id);
      if (refUrls.length > 0) {
        formData.append("reference_urls", refUrls.join(","));
      }

      const data = await apiPost(apiUrl('QUIZ_AUDIO'), formData);
      if (myGeneration !== submissionGenerationRef.current || !mountedRef.current) return;

      if (!data.success) {
        console.error("比對失敗:", data.error);
        setError(compareFailureMessage(data));
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
    const myShareGeneration = shareGenerationRef.current;
    const q = questions[current];
    const stillCurrent = () => mountedRef.current && myShareGeneration === shareGenerationRef.current;
    try {
      let uploaded = uploadedRecordingRef.current;
      if (!uploaded || uploaded.blob !== audioBlob) {
        const storageUrl = await uploadRecording(tribe, q.word, userData.uid, audioBlob);
        uploaded = { blob: audioBlob, storageUrl };
        if (stillCurrent()) uploadedRecordingRef.current = uploaded;
      }
      await saveRecordingMeta(tribe, q.word, userData.uid, score, uploaded.storageUrl);
      if (!stillCurrent()) return;
      setShareState("shared");
    } catch (err) {
      console.error("分享錄音失敗:", err.message);
      if (!stillCurrent()) return;
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
        onStartRecording={handleStartRecording}
        onStopRecording={stopRecording}
        onPlayUserAudio={handlePlayUserAudio}
        onResetRecState={resetRecState}
        submitting={submitting}
        onSubmit={submitAudio}
        score={score}
        officialScore={officialScore}
        error={error}
        onNext={handleNext}
        shareState={shareState}
        onShare={handleShare}
        tribe={tribe}
        canShare={!audioBlob || audioBlob.type === "audio/webm"}
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
        tribe={tribe}
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
