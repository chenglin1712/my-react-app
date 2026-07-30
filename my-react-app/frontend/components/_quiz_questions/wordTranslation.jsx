import { useState, useRef, useEffect } from "react";
import { Languages, Check, CircleCheck, CircleX } from "lucide-react";
import lottie from "lottie-web";
import { FaPlayCircle } from 'react-icons/fa';
import successAnimation from "../../src/animations/success.json";
import { createAuthorizedAudio } from "../../utils/authAudio";
import { playCorrectSound } from "../../utils/correctSound";

export default function WordTranslation({ question, selected, checked, onSelect, onConfirm }) {
   const [result, setResult] = useState("");
    const audioRef = useRef(null);
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


    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      // pause() 不會觸發 authAudio.js 內建的 ended/error revoke，手動切換/
      // 停止播放要自己呼叫，不然每切一次語音就洩漏一個 blob URL。
      audioRef.current.revokeObjectUrl?.();
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

  const handleSelect = (word) => {
    const newSelection = selected === word ? null : word;
    onSelect(newSelection);
  };
  const handleConfirm = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.revokeObjectUrl?.();
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
        playCorrectSound();
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
