// 把 quiz.data / answers / correctAnswers / results 這三個用 index 對齊的
// 平行陣列，合併成一份「每一題一筆」的清單，取代到處用同一個 idx 分別查
// 三個陣列（review.jsx 原本 viewQuestion 就漏了其中一個陣列的防護）。
export function buildReviewQuestions({ questions, answers, correctAnswers, results }) {
  if (!questions) return [];
  return questions.map((item, idx) => ({
    idx,
    item,
    userAnswerNum: answers?.[idx],
    correctAnswerNum: correctAnswers?.[idx],
    isCorrect: results?.[idx]?.isCorrect,
  }));
}

// 題目清單裡沒有單一「題目文字」欄位可以顯示的題型（配合題只有 pairs，
// 閱讀填空是 passage_ab）要各自給一個保底標籤。
export function getReviewQuestionLabel(item, idx) {
  if (item.question_ab) return item.question_ab;
  if (item.question_ch) return item.question_ch;
  if (item.passage_ab) return item.passage_ab;
  if (item.pairs) return "配合題";
  return `第 ${idx + 1} 題`;
}
