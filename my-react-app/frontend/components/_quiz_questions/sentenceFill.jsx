import { useState } from "react";
import { RectangleEllipsis, Volume2, Check, CircleCheck, CircleX } from "lucide-react";
import { FaPlayCircle } from 'react-icons/fa';
import successAnimation from "../../src/animations/success.json";
import useAuthorizedAudioPlayback from "../../hooks/useAuthorizedAudioPlayback";
import { useLottieAnimation } from "../../hooks/useLottieAnimation";
import { playCorrectSound } from "../../utils/correctSound";

export default function SentenceFill({ question, selected, checked, onSelect, onConfirm }) {
  const [result, setResult] = useState("");
  const [showAnimation, setShowAnimation] = useState(false);
  const { playAudio, stopAudio } = useAuthorizedAudioPlayback();
  const animationRef = useLottieAnimation({
    animationData: successAnimation,
    enabled: showAnimation,
    loop: false,
    onComplete: () => setShowAnimation(false),
  });

  const handleSelect = (word) => {
    const newSelection = selected === word ? null : word;
    onSelect(newSelection);
  };

  const handleConfirm = () => {
    stopAudio();
    const isCorrect = selected === question.answer;
    setResult(isCorrect ? "correct" : "wrong");
    onSelect?.({
      result: isCorrect,
      userAnswer: selected,
      correctAnswer: question.answer,
      question: question.tayal.sentence,
      answer: question.options,
    });
    onConfirm?.(true);
    if (isCorrect) {
      playCorrectSound();
      setShowAnimation(true);
    }
  };

  // 只顯示真的出現在選項裡的錯誤形說明（後端沒帶 distractorNotes 就是原本的隨機干擾項，什麼都不多顯示）。
  const optionWords = new Set((question.options || []).map((opt) => opt.word));
  const distractorNotes = Object.entries(question.distractorNotes || {}).filter(([word]) => optionWords.has(word));

  const getOptionClass = (word) => {
    if (!checked) return selected === word ? "selected" : "";
    if (word === question.answer) return "correct";
    if (selected === word && word !== question.answer) return "wrong";
    return "";
  };

  return (
    <div className="text-center" style={{ minHeight: "400px" }}>
      <h5 className="fw-bolder mb-4" style={{ display: 'flex', alignItems: 'center', justifyContent: "center" }}>
        <RectangleEllipsis />&nbsp; 句子填空
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

      <div className="options-list">
        {question.options.map((opt) => (
          <button
            type="button"
            key={opt.word}
            onClick={(e) => {
              if (!checked) handleSelect(opt.word);
              e.stopPropagation();
              playAudio(opt.audio);
            }}
            className={`custom-btn ${getOptionClass(opt.word)}`}
          >
            {opt.word}
            {opt.audio && (
              <span className="cursor-pointer text-sm">
                &nbsp;
                <Volume2 size={15} className="inline ml-1" />
              </span>
            )}
          </button>
        ))}
      </div>

      {!checked ? (
        <button type="button" onClick={handleConfirm} className="confirm-btn" disabled={!selected}>
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
          {distractorNotes.length > 0 && (
            <div className="text-start mx-auto mb-4" style={{ maxWidth: "32rem" }}>
              <p className="fw-bold mb-1">錯誤選項是怎麼造出來的</p>
              <ul className="mb-1 ps-3">
                {distractorNotes.map(([word, note]) => (
                  <li key={word}><strong>{word}</strong>：{note}</li>
                ))}
              </ul>
              <p className="text-muted small mb-0">
                這些是依詞綴規則造出的「候選」錯誤形，辭典與例句中都找不到；
                但辭典不可能收錄所有詞形，不代表它在族語裡一定不存在。
              </p>
            </div>
          )}
        </>
      )}

      {/* 成功動畫 Overlay */}
      {showAnimation && (
        <div className="yy-success-overlay">
          <div className="yy-success-card">
            <div ref={animationRef} />
            <p>答案正確！</p>
          </div>
        </div>
      )}
    </div>
  );
}
