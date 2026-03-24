import React, { useState, useRef, useEffect } from "react";
import { Mic , Volume2, Check, CircleCheck, CircleX } from "lucide-react";
import { FaMicrophone, FaStop, FaPlayCircle, FaRedo } from 'react-icons/fa';
import lottie from "lottie-web";
import successAnimation from "../../src/animations/success.json";
import correctAudio from "../../static/assets/_quiz/correct.mp3";

export default function sentenceSpeak({ question, selected, checked, onSelect, onConfirm }) {
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [recording, setRecording] = useState(false);
  const [audio, setAudio] = useState(null);
  const mediaRecorder = useRef(null);
  const chunks = useRef([]);
  const [result, setResult] = useState(null);
  const [score, setScore] = useState(null);
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


    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }


    const proxyUrl = import.meta.env.VITE_API_SEARCH_AUDIO_URL + fileId;
    const newAudio = new Audio(proxyUrl);

    newAudio.play().catch(err => console.error("播放失敗:", err));
    setAudio(newAudio);
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
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    if (!audioBlob) return;

    const formData = new FormData();
    formData.append("user_audio", audioBlob, "speech.webm");
    formData.append("audio_id", question.tayal.audio);

    try {
      const res = await fetch(import.meta.env.VITE_API_QUIZ_AUDIO_URL, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
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
      onConfirm?.(true);
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
        <button className="btn btn-danger mb-3" onClick={startRecording} disabled={audioBlob} style={{padding: "20px"}}>
          <FaMicrophone size={60}/> 
        </button>
      ) : (
        <button className="btn btn-secondary mb-3" onClick={stopRecording}style={{padding: "30px"}}>
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
          
            <button
                className="confirm-btn"
                disabled={!audioBlob}
                onClick={submitSpeaking}
            >
                <Check />&nbsp; 確認
            </button>
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
