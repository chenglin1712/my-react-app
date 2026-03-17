import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../../firebase";
import { doc, getDoc, getDocs, collection } from "firebase/firestore";
import SentenceFill from "../_test/sentenceFill";
import SentenceSpeak from "../_test/sentenceSpeak";
import SentenceOrder from "../_test/sentenceOrder";
import WordMatch from "../_test/wordMatch";
import WordTranslation from "../_test/wordTranslation";
import "../../static/css/_quiz/quiz_recommon_question.css";


function QuestionRenderer({ question, selected, checked, onSelect, onConfirm }) {
  switch (question.type) {
    case "sentence-fill":
      return (
        <SentenceFill
          question={question}
          selected={selected}
          checked={checked}
          onSelect={onSelect}
          onConfirm={onConfirm}
        />
      );
      case "sentence-speak":
      return (
        <SentenceSpeak
          question={question}
          selected={selected}
          checked={checked}
          onSelect={onSelect}
          onConfirm={onConfirm}
        />
      );
    case "sentence-order":
      return (
        <SentenceOrder
          question={question}
          selected={selected}
          checked={checked}
          onSelect={onSelect}
          onConfirm={onConfirm}
        />
      );
    case "word-match":
      return (
        <WordMatch
          question={question}
          selected={selected}
          checked={checked}
          onSelect={onSelect}
          onConfirm={onConfirm}
        />
      );
    case "word-translate":
      return (
        <WordTranslation
          question={question}
          selected={selected}
          checked={checked}
          onSelect={onSelect}
          onConfirm={onConfirm}
        />
      );
    default:
      return <p>未知題型</p>;
  }
}

export default function QuizPage() {
  const questionList = useMemo(
    () => [
      {
        id: 1,
        type: "sentence-fill",
        tayal: { word: "ga", exsentence: "Kun ga Sayun", sentence: "Kun ___ Sayun.", cn: "我是Sayun。", audio: "354ff9e1-b516-f011-bd67-00155db40116" },
        options: [
          { word: "lga", audio: "354ff9e1-b516-f011-bd67-00155db40116" },
          { word: "ga", audio: "" },
          { word: "mga", audio: "f1b0fb12-b616-f011-bd67-00155db40116" },
          { word: "lmga", audio: "d6cc14ee-b516-f011-bd67-00155db40116" },
        ],
        answer: "ga",
      },
      {
        id: 2,
        type: "sentence-speak",
        tayal: { word: "gaga'", sentence: "plgay ta' gaga' na Tayal.", cn: "讓我們來遵循泰雅族的文化習俗。", audio: "e8869171-bc16-f011-bd67-00155db40116" },
        answer: "plgay ta' gaga' na Tayal.",
      },
      {
        id: 3,
        type: "sentence-order",
        tayal: { word: "ga", sentence: "Kun ga Sayun.", cn: "我是Sayun。", audio: "354ff9e1-b516-f011-bd67-00155db40116" },
        words: [
          { word: "ga", audio: "" },
          { word: "Kun", audio: "aaf1ebc9-b516-f011-bd67-00155db40116" },
          { word: "Sayun.", audio: "a4f20153-b916-f011-bd67-00155db40116" },
        ],
        answer: ["Kun", "ga", "Sayun."],
      },
      {
        id: 4,
        type: "word-match",
        pairs: [
          { cn: "太陽", tayal: { word: "wagi'", audio: "" } },
          { cn: "月亮", tayal: { word: "bzyacing", audio: "b0209c94-b116-f011-bd67-00155db40116" } },
          { cn: "[虛]", tayal: { word: "ga", audio: "" } },
          { cn: "我", tayal: { word: "kun", audio: "aaf1ebc9-b516-f011-bd67-00155db40116" } },
          { cn: "女子名", tayal: { word: "Sayun", audio: "a4f20153-b916-f011-bd67-00155db40116" } },
        ],
      },
      {
        id: 5,
        type: "word-translate",
        tayal: { word: "bzyacing", cn: "月亮", audio: "b0209c94-b116-f011-bd67-00155db40116" },
        options: ["太陽", "月亮", "火", "水"],
        answer: "月亮",
      },
    ],
    []
  );

  const [current, setCurrent] = useState(0);
  const [checked, setChecked] = useState(false);
  const [selected, setSelected] = useState(null); 
  const [userAnswers, setUserAnswers] = useState([]);
  const navigate = useNavigate();

  // 計時
  const [totalTime, setTotalTime] = useState(0);
  const [questionTime, setQuestionTime] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTotalTime((t) => t + 1);
      setQuestionTime((t) => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

 const handleNext = () => {
  if (!selected) return; // 未答題，不進行下一題

  // 使用各題型回傳的正確狀態
  const isCorrect = selected?.result ;

  // 更新答題紀錄，加入 questionTime
  const currentQ = questionList[current];
  const updatedAnswers = [
    ...userAnswers,
    {
      id: currentQ.id,
      type: currentQ.type,
      question: selected.question,
      answer: selected.answer,
      userAnswer: selected.userAnswer,
      correct: isCorrect,
      correctAnswer:selected.correctAnswer,
      timeSpent: questionTime, // ✅ 記錄作答時間
    },
  ];
  setUserAnswers(updatedAnswers);

  if (current + 1 < questionList.length) {
    setCurrent(current + 1);
    setChecked(false);
    setSelected(null);
    setQuestionTime(0); // 下一題時間歸零
  } else {
    // 測驗結束 → 導向結果頁
    const correctCount = updatedAnswers.filter((a) => a.correct).length;
    const accuracy = Math.round((correctCount / questionList.length) * 100);

    navigate("../result", {
      state: {
        totalTime: formatTime(totalTime),
        accuracy,
        userAnswers: updatedAnswers,
        analysis: "你的強項是詞彙題，句子排序較弱。",
        suggestion: "建議多練習句子排序，加強語法理解。",
      },
    });
  }
};

  return (
    <div
      className="w-full max-w-3xl bg-white shadow-xl rounded-2xl p-8 flex flex-col items-center"
      style={{ minHeight: "calc(100vh - 110px)" }}
    >
      {/* 進度條 */}
      <div className="w-full self-stretch bg-gray-200 rounded-full h-3 mb-4 overflow-hidden">
        <div
          className="bg-green-500 h-3 transition-[width] duration-500"
          style={{ width: `${((current + 1) / questionList.length) * 100}%` }}
        />
      </div>

      <h6 className="text-sm text-gray-600 mb-2 text-center">
        第 {current + 1} / {questionList.length} 題
      </h6>

      {/* 題目區 */}
      <div className="flex flex-col items-center justify-center w-full overflow-auto">
        <QuestionRenderer
          question={questionList[current]}
          selected={selected}
          checked={checked}
          onSelect={(val) => setSelected(val)}
          onConfirm={() => {setChecked(true);}}
        />
      </div>

      {/* 下一題按鈕 */}
      {current < questionList.length && (
        <div className="w-full flex justify-center mt-6" style={{ textAlign: "center" }}>
          <button
            onClick={handleNext}
            className={`custom-btn mt-3 ${!checked ? "opacity-50 cursor-not-allowed" : ""}`}
            disabled={!checked}
            style={{ cursor: !checked ? "not-allowed" : "pointer" }}
          >
            {current === questionList.length - 1 ? "結束測驗" : "下一題"}
          </button>
        </div>
      )}
    </div>
  );
}
