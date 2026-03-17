import React, { useState, useRef, useEffect } from "react";
import { Languages, Volume2, Check, CircleCheck, CircleX } from "lucide-react";
import lottie from "lottie-web";
import { FaPlayCircle } from 'react-icons/fa';
import { Button } from 'react-bootstrap';
import successAnimation from "../../src/animations/success.json";
import correctAudio from "../../static/assets/_quiz/correct.mp3";

export default function WordTranslation({ question, selected, checked, onSelect, onConfirm }) {
   const [result, setResult] = useState("");
    const [audio, setAudio] = useState(null);
    const [showAnimation, setShowAnimation] = useState(false);
    const animation = useRef(null);
  useEffect(() => {
    if (result === "correct" && showAnimation) {
      const instance = lottie.loadAnimation({
        container: animation.current,
        renderer: "svg",
        loop: false, // ✅ 播一次
        autoplay: true,
        animationData: successAnimation,
      });

      // ✅ 動畫結束後自動隱藏
      instance.addEventListener("complete", () => {
        setShowAnimation(false);
      });

      return () => instance.destroy();
    }
  }, [result, showAnimation]);
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

  const handleSelect = (word) => {
    const newSelection = selected === word ? null : word;
    onSelect(newSelection);
  };
  const handleConfirm = () => {
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    const isCorrect = selected === question.answer;
    setResult(isCorrect ? "correct" : "wrong");
    onSelect?.({
      result: isCorrect,
      userAnswer: selected, 
      correctAnswer:  question.answer, 
      question: question.tayal.word, 
      answer: question.options         
    });
    onConfirm?.(true);
     if (isCorrect) {
        const correctSound = new Audio(correctAudio);
        correctSound.play();
        setShowAnimation(true);
      }
  };

  const getOptionClass = (word) => {
    if (!checked) return selected === word ? "selected" : "";
    if (word === question.answer) return "correct";       // 正確答案綠色
    if (selected === word && word !== question.answer) return "wrong"; // 選錯紅色
    return "";
  };



  return (
    <div className="text-center" style={{ minHeight: "400px" }}>
      <h5 className="fw-bolder mb-4" style={{ display: 'flex', alignItems: 'center',justifyContent: "center"  }}>
        <Languages />&nbsp;單詞翻譯
      </h5>

      <h2 className="fw-bolder mb-4 " style={question.tayal.audio?{cursor: "pointer"}:""}onClick={() => {if(question.tayal.audio) playAudio(question.tayal.audio);}}>
                      {question.tayal.word}
                      {question.tayal.audio && (
                        <span>
                        &nbsp; 
                        <FaPlayCircle size={20} className="text-warning" />
                        </span>
                      )} 
            </h2>
        


      <div className="options-list">
        {question.options.map((opt) => (
          <button
            key={opt}
            onClick={() => !checked && handleSelect(opt)}
            className={`custom-btn ${getOptionClass(opt)}`}
          >
            {opt}
          </button>
        ))}
      </div>

      {!checked ? (
        <button
          onClick={handleConfirm}
          className="confirm-btn"
          disabled={!selected}
        >
          <Check />&nbsp;確認
        </button>
      ) : (
        <>
            {result === "correct" ? (
            <h4 className="fw-bolder mb-4 text-success"><CircleCheck />&nbsp; 正確</h4>
          ) : (
            <h4 className="fw-bolder mb-4 text-danger"><CircleX />&nbsp;  錯誤</h4>
          )}
          <h4 className="fw-bolder mb-4 ">
            正確答案：{question.answer}
          </h4>
        </>
      )}

      {/* ✅ 成功動畫 Overlay */}
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
