import { useState, useRef, useEffect } from "react";
import { Mic, Check, CircleCheck, CircleX } from "lucide-react";
import { FaMicrophone, FaStop, FaPlayCircle, FaRedo } from 'react-icons/fa';
import successAnimation from "../../src/animations/success.json";
import useAuthorizedAudioPlayback from "../../hooks/useAuthorizedAudioPlayback";
import { useLottieAnimation } from "../../hooks/useLottieAnimation";
import { apiPost } from "../../utils/apiClient";
import { playCorrectSound } from "../../utils/correctSound";

export default function SentenceSpeak({ question, _selected, checked, onSelect, onConfirm }) {
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [recordError, setRecordError] = useState(null);
  const mediaRecorder = useRef(null);
  const chunks = useRef([]);
  const stream = useRef(null);
  const recordingUrlRef = useRef(null);
  const userAudioRef = useRef(null);
  const mountedRef = useRef(true);
  const [result, setResult] = useState(null);
  const [score, setScore] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const { playAudio, stopAudio } = useAuthorizedAudioPlayback();
  const [showAnimation, setShowAnimation] = useState(false);
  const animationRef = useLottieAnimation({
    animationData: successAnimation,
    enabled: showAnimation,
    loop: false,
    onComplete: () => setShowAnimation(false),
  });

  function releaseRecordingUrl() {
    if (recordingUrlRef.current) {
      URL.revokeObjectURL(recordingUrlRef.current);
      recordingUrlRef.current = null;
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // unmount 時：麥克風還開著要關掉、使用者自己的錄音播放要停掉、
      // 錄音的 blob URL 要釋放掉，不然離開這一題後這些資源都不會被回收。
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      userAudioRef.current?.pause();
      userAudioRef.current = null;
      releaseRecordingUrl();
    };
  }, []);

  // 🎤 開始錄音
  const startRecording = async () => {
    if (recording || starting) return;
    setStarting(true);
    setRecordError(null);
    setResult(null);
    setScore(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = s;
      mediaRecorder.current = new MediaRecorder(s);
      chunks.current = [];

      mediaRecorder.current.ondataavailable = (e) => chunks.current.push(e.data);
      mediaRecorder.current.onstop = () => {
        if (!mountedRef.current) return;
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        releaseRecordingUrl();
        const url = URL.createObjectURL(blob);
        recordingUrlRef.current = url;
        setAudioBlob(blob);
        setAudioUrl(url);
      };

      mediaRecorder.current.start();
      setRecording(true);
    } catch (err) {
      console.error('startRecording error:', err);
      setRecordError('無法使用麥克風，請確認已允許瀏覽器存取麥克風權限。');
    } finally {
      setStarting(false);
    }
  };

  // 🛑 停止錄音
  const stopRecording = () => {
    mediaRecorder.current?.stop();
    // MediaRecorder.stop() 不會釋放底層 stream，麥克風錄音中指示燈會持續亮著
    // （這裡是獨立內嵌重寫的錄音邏輯，沒有共用 _game/pronunciation/useAudioRecorder.js，
    // 同樣的問題要在這裡另外修一次）。
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setRecording(false);
  };

  // ▶ 播放自己的錄音
  const playUserAudio = () => {
    if (!audioUrl) return;
    userAudioRef.current?.pause();
    const audio = new Audio(audioUrl);
    userAudioRef.current = audio;
    audio.play().catch(() => {});
  };

  // 🔁 重新錄音
  const redoRecording = () => {
    userAudioRef.current?.pause();
    userAudioRef.current = null;
    releaseRecordingUrl();
    setAudioBlob(null);
    setAudioUrl(null);
    setResult(null);
    setScore(null);
  };
  // 📤 送到後端比對
  const submitSpeaking = async () => {
    stopAudio();
    if (!audioBlob || submitting) return;

    const formData = new FormData();
    formData.append("user_audio", audioBlob, "speech.webm");
    formData.append("audio_id", question.tayal.audio);

    setSubmitting(true);
    setSubmitError(null);
    try {
      const data = await apiPost(import.meta.env.VITE_API_QUIZ_AUDIO_URL, formData);

      // compare_audio 失敗（ffmpeg 缺失、下載失敗、解碼錯誤等）時 HTTP 狀態碼仍是 200，
      // 只有 body 的 success 欄位是 false，這是 app 層的失敗，不是 HTTP 錯誤，
      // apiPost 不會把它轉成例外，得另外檢查。後端回傳的錯誤細節可能包含
      // ffmpeg/解碼器的內部訊息，不直接顯示給使用者，只 log 給開發者看。
      if (!data.success) {
        console.error('submitSpeaking app-level error:', data.error);
        setSubmitError('比對失敗，請稍後再試一次。');
        setSubmitting(false);
        return;
      }

      setScore(data.score);
      setResult(data.passed ? "correct" : "wrong");
      onSelect?.({
        result: data.passed,
        userAnswer: audioBlob,
        correctAnswer: question.answer,
        question: question.tayal.sentence,
        answer: question.tayal.audio,
      });
      onConfirm?.(true);
      if (data.passed) {
        playCorrectSound();
        setShowAnimation(true);
      }
    } catch (err) {
      console.error('submitSpeaking error:', err);
      setSubmitError('評分失敗，請檢查網路連線後再試一次。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
   <div className="text-center" style={{ minHeight: "400px" }}>
      <h5 className="fw-bolder mb-4" style={{ display: 'flex', alignItems: 'center', justifyContent: "center" }}>
        <Mic />&nbsp; 口說練習
      </h5>

      <h2 className="fw-bolder mb-4" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
        {question.tayal.sentence}
        {question.tayal.audio && (
          <button
            type="button"
            className="quiz-audio-btn"
            onClick={() => playAudio(question.tayal.audio)}
            aria-label="播放句子語音"
          >
            <FaPlayCircle size={20} className="text-warning" />
          </button>
        )}
      </h2>
        <br/><br/>
        <br/><br/>

      {recordError && <p className="text-danger" role="alert">{recordError}</p>}

      {/* 錄音按鈕 */}
      {!recording ? (
        <button type="button" className="btn btn-danger mb-3" onClick={startRecording} disabled={!!audioBlob || starting} style={{padding: "20px"}} aria-label="開始錄音">
          <FaMicrophone size={60}/>
        </button>
      ) : (
        <button type="button" className="btn btn-secondary mb-3" onClick={stopRecording} style={{padding: "30px"}} aria-label="停止錄音">
          <FaStop size={30}/>
        </button>
      )}
       {audioBlob && !recording &&(
        <div className="mb-3">
          <button type="button" className="btn btn-primary me-2" onClick={playUserAudio}>
            <FaPlayCircle /> 重聽你的錄音
          </button>

          <button type="button" className="btn btn-warning me-2" onClick={redoRecording}>
            <FaRedo /> 重新錄音
          </button>
        </div>
        )}
        <br/><br/>
        {!checked ? (
          <>
            {submitError && <p className="text-danger" role="alert">{submitError}</p>}
            <button
                type="button"
                className="confirm-btn"
                disabled={!audioBlob || submitting}
                onClick={submitSpeaking}
            >
                <Check />&nbsp; {submitting ? "評分中..." : "確認"}
            </button>
          </>
      ):(
        <>
        {result === "correct" ? (
            <h4 className="fw-bolder mt-4 text-success">
              <CircleCheck /> 正確！（分數：{score}）
            </h4>
          ) : (
            <h4 className="fw-bolder mt-4 text-danger">
              <CircleX /> 錯誤（分數：{score}）
            </h4>
          )}
          </>
          )
      }

      {/* 成功動畫 */}
      {showAnimation && (
        <div className="overlay">
          <div className="animation-container">
            <div ref={animationRef} />
            <p>答案正確！</p>
          </div>
        </div>
      )}
    </div>
  );
}
