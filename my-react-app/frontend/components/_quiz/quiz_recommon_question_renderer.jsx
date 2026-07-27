import SentenceFill from "../_quiz_questions/sentenceFill";
import SentenceSpeak from "../_quiz_questions/sentenceSpeak";
import SentenceOrder from "../_quiz_questions/sentenceOrder";
import WordMatch from "../_quiz_questions/wordMatch";
import WordTranslation from "../_quiz_questions/wordTranslation";

// 薦讀測驗依題型分派到對應的作答元件，從 quiz_recommon_question.jsx 抽出來。
export default function QuestionRenderer({ question, selected, checked, onSelect, onConfirm }) {
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
