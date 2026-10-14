import { useState } from "react";
import { Languages, Check, CircleCheck, CircleX } from "lucide-react";
import { FaPlayCircle } from 'react-icons/fa';
import useAuthorizedAudioPlayback from "../../hooks/useAuthorizedAudioPlayback";
import { playCorrectSound } from "../../utils/correctSound";

export default function WordTranslation({ question, selected, checked, onSelect, onConfirm }) {
  const [result, setResult] = useState("");
  const { playAudio, stopAudio } = useAuthorizedAudioPlayback();

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
      question: question.tayal.word,
      answer: question.options,
    });
    onConfirm?.(true);
    if (isCorrect) {
      playCorrectSound();
    }
  };

  const getOptionClass = (word) => {
    if (!checked) return selected === word ? "selected" : "";
    if (word === question.answer) return "correct";
    if (selected === word && word !== question.answer) return "wrong";
    return "";
  };

  return (
    <div className="text-center" style={{ minHeight: "400px" }}>
      <h5 className="fw-bolder mb-4" style={{ display: 'flex', alignItems: 'center', justifyContent: "center" }}>
        <Languages />&nbsp;單詞翻譯
      </h5>

      <h2 className="fw-bolder mb-4" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
        {question.tayal.word}
        {question.tayal.audio && (
          <button
            type="button"
            className="quiz-audio-btn"
            onClick={() => playAudio(question.tayal.audio)}
            aria-label="播放語音"
          >
            <FaPlayCircle size={20} className="yy-text-blue" />
          </button>
        )}
      </h2>

      <div className="options-list">
        {question.options.map((opt) => (
          <button
            type="button"
            key={opt}
            onClick={() => !checked && handleSelect(opt)}
            className={`custom-btn ${getOptionClass(opt)}`}
          >
            {opt}
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
            <h4 className="fw-bolder mb-4 yy-text-success yy-correct-pop"><CircleCheck />&nbsp; 正確</h4>
          ) : (
            <h4 className="fw-bolder mb-4 yy-text-danger"><CircleX />&nbsp;  錯誤</h4>
          )}
          <h4 className="fw-bolder mb-4 ">
            正確答案：{question.answer}
          </h4>
        </>
      )}

    </div>
  );
}
