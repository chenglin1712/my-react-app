// 薦讀測驗（IRT）結束後的強項/弱項分析，從 quiz_recommon_question.jsx 抽出來。

// 依題型取出這一題要記錄進 IRT user_model 的關鍵字。word-match 一題含多個配對，
// 沒有單一「這題在考哪個字」的答案，退而求其次記錄第一組配對的族語詞。
export function getWordNameForQuestion(question) {
  if (question.type === "word-match") {
    return question.pairs?.[0]?.tayal?.word || "";
  }
  return question.tayal?.word || "";
}

const TYPE_LABELS = {
  "word-translate": "單字翻譯",
  "word-match": "單字配對",
  "sentence-fill": "句子填空",
  "sentence-order": "句子排序",
};

// 依這次測驗實際答對/答錯的題型分布，計算強項/弱項分析文字，
// 取代原本無論作答結果為何都顯示同一段固定文字的寫法。
export function buildResultAnalysis(answers) {
  const stats = {};
  for (const a of answers) {
    if (!stats[a.type]) stats[a.type] = { correct: 0, total: 0 };
    stats[a.type].total += 1;
    if (a.correct) stats[a.type].correct += 1;
  }

  const entries = Object.entries(stats).map(([type, { correct, total }]) => ({
    label: TYPE_LABELS[type] || type,
    accuracy: total > 0 ? correct / total : 0,
  }));

  if (entries.length === 0) {
    return {
      analysis: "本次測驗尚無足夠資料進行分析。",
      suggestion: "建議多做幾次測驗，才能看出你的強弱項。",
    };
  }

  entries.sort((a, b) => b.accuracy - a.accuracy);
  const best = entries[0];
  const worst = entries[entries.length - 1];

  if (entries.length === 1 || best.accuracy === worst.accuracy) {
    return {
      analysis: `你在${best.label}的正確率為 ${Math.round(best.accuracy * 100)}%。`,
      suggestion: `建議持續練習${best.label}，穩固已有的基礎。`,
    };
  }

  return {
    analysis: `你的強項是${best.label}（正確率 ${Math.round(best.accuracy * 100)}%），${worst.label}較弱（正確率 ${Math.round(worst.accuracy * 100)}%）。`,
    suggestion: `建議多練習${worst.label}，加強相關能力。`,
  };
}
