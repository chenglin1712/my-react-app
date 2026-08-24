import SentenceFill from "../_quiz_questions/sentenceFill";
import SentenceOrder from "../_quiz_questions/sentenceOrder";
import WordMatch from "../_quiz_questions/wordMatch";
import WordTranslation from "../_quiz_questions/wordTranslation";

// 薦讀測驗依題型分派到對應的作答元件，從 quiz_recommon_question.jsx 抽出來。
// 五個題型元件收到的 props 完全一樣，用 lookup map 分派（而不是逐 case 手寫）
// 比較不會漏改；quiz_recommon_question.jsx 也用 QUESTION_COMPONENTS 的 key
// 集合判斷「這題是不是支援的題型」，卡在未知題型時提供離開測驗的出口，
// 而不是讓使用者卡在一個永遠無法按下「下一題」的畫面。
//
// sentence-speak（components/_quiz_questions/sentenceSpeak.jsx，功能與測試都在）
// 沒有註冊在這裡：目前後端的薦讀測驗產生器（backend/fastAPI/routes/quiz/generator.py）
// 從不產生這個題型，註冊了也永遠不會被觸發。等後端真的支援這個題型時再加回來，
// 避免讓人誤以為現在就有在用。
export const QUESTION_COMPONENTS = {
  "sentence-fill": SentenceFill,
  "sentence-order": SentenceOrder,
  "word-match": WordMatch,
  "word-translate": WordTranslation,
};

export default function QuestionRenderer({ question, selected, checked, onSelect, onConfirm }) {
  const Component = question ? QUESTION_COMPONENTS[question.type] : undefined;

  if (!Component) {
    return <p>未知題型</p>;
  }

  return (
    <Component
      question={question}
      selected={selected}
      checked={checked}
      onSelect={onSelect}
      onConfirm={onConfirm}
    />
  );
}
