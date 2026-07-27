import { useState, useRef, useEffect } from "react";
import { Mic, Check, CircleCheck, CircleX } from "lucide-react";
import { FaMicrophone, FaStop, FaPlayCircle, FaRedo } from 'react-icons/fa';
import lottie from "lottie-web";
import successAnimation from "../../src/animations/success.json";
import correctAudio from "../../static/assets/_quiz/correct.mp3";
import { createAuthorizedAudio } from "../../utils/authAudio";
import { apiPost } from "../../utils/apiClient";

export default function SentenceSpeak({ question, _selected, checked, onSelect, onConfirm }) {
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [recording, setRecording] = useState(false);
  const audioRef = useRef(null);
  const mediaRecorder = useRef(null);
  const chunks = useRef([]);
  const [result, setResult] = useState(null);
  const [score, setScore] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const animation = useRef(null);
  const [showAnimation, setShowAnimation] = useState(false);

   

  // 🎤 開始錄音
  const startRecording = async () => {
    setResult(null);
    setScore(null);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder.current = new MediaRecorder(stream);
    chunks.current = [];

    mediaRecorder.current.ondataavailable = (e) => chunks.current.push(e.data);
    mediaRecorder.current.onstop = () => {
      const blob = new Blob(chunks.current, { type: "audio/webm" });
      setAudioBlob(blob);
      setAudioUrl(URL.createObjectURL(blob));
    };

    mediaRecorder.current.start();
    setRecording(true);
  };

  // 🛑 停止錄音
  const stopRecording = () => {
    mediaRecorder.current.stop();
    setRecording(false);
  };

  // ▶ 播放題目音檔
  const playAudio = async (fileId) => {
    if (!fileId) return;


    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }


    const proxyUrl = import.meta.env.VITE_API_SEARCH_AUDIO_URL + fileId;
    let newAudio;
    try {
      newAudio = await createAuthorizedAudio(proxyUrl);
    } catch {
      return;
    }

    newAudio.play().catch(() => {});
    audioRef.current = newAudio;
  };
  // ▶ 播放自己的錄音
  const playUserAudio = () => {
    if (audioUrl) new Audio(audioUrl).play();
  };

    // 🔁 重新錄音
  const redoRecording = () => {
    setAudioBlob(null);
    setAudioUrl(null);
    setResult(null);
    setScore(null);
  };  
  // 📤 送到後端比對
  const submitSpeaking = async () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
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
      // apiPost 不會把它轉成例外，得另外檢查。
      if (!data.success) {
        setSubmitError(`比對失敗：${data.error || "未知錯誤"}`);
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
        const correctSound = new Audio(correctAudio);
        correctSound.play();
        setShowAnimation(true);
      }
    } catch (err) {
      console.error('submitSpeaking error:', err);
      setSubmitError('評分失敗，請檢查網路連線後再試一次。');
    } finally {
      setSubmitting(false);
    }
  };


  // 動畫
  useEffect(() => {
    if (result === "correct" && showAnimation) {
      const instance = lottie.loadAnimation({
        container: animation.current,
        renderer: "svg",
        loop: false,
        autoplay: true,
        animationData: successAnimation,
      });

      instance.addEventListener("complete", () => setShowAnimation(false));

      return () => instance.destroy();
    }
  }, [result, showAnimation]);

  return (
   <div className="text-center" style={{ minHeight: "400px" }}>
      <h5 className="fw-bolder mb-4" style={{ display: 'flex', alignItems: 'center',justifyContent: "center"  }}>
        <Mic />&nbsp; 口說練習
      </h5>

      <h2 className="fw-bolder mb-4 " style={question.tayal.audio?{cursor: "pointer"}:""}onClick={() => {if(question.tayal.audio) playAudio(question.tayal.audio);}}>
                      {question.tayal.sentence}
                      {question.tayal.audio && (
                        <span>
                        &nbsp; 
                        <FaPlayCircle size={20} className="text-warning" />
                        </span>
                      )} 
        </h2>
        <br/><br/>
        <br/><br/>

      {/* 錄音按鈕 */}
      {!recording ? (
        <button className="btn btn-danger mb-3" onClick={startRecording} disabled={audioBlob} style={{padding: "20px"}} aria-label="開始錄音">
          <FaMicrophone size={60}/>
        </button>
      ) : (
        <button className="btn btn-secondary mb-3" onClick={stopRecording}style={{padding: "30px"}} aria-label="停止錄音">
          <FaStop size={30}/>
        </button>
      )}
       {audioBlob && !recording &&(
        <div className="mb-3">
          <button className="btn btn-primary me-2" onClick={playUserAudio}>
            <FaPlayCircle /> 重聽你的錄音
          </button>

          <button className="btn btn-warning me-2" onClick={redoRecording}>
            <FaRedo /> 重新錄音
          </button>
        </div>
        )}
        <br/><br/>
        {!checked ? (
          <>
            {submitError && <p className="text-danger">{submitError}</p>}
            <button
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
            <div ref={animation} />
            <p>答案正確！</p>
          </div>
        </div>
      )}
    </div>
  );
}
