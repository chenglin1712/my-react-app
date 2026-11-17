// 摘要只留「一句例句」（詞、意思、發音在 sheet 標題列）；其餘內容用「看完整內容」展開（P2-1 漸進揭露）。
// 回傳只含第一個有字的例句的精簡結果，沒有例句時回傳 null。
export const pickFirstSentence = (result) => {
  for (const def of result?.explanationItems || []) {
    const sentence = def.sentenceItems?.find((ex) => ex.originalSentence?.trim() || ex.chineseSentence?.trim());
    if (sentence) return sentence;
  }
  return null;
};

export const pickSummary = (result) => {
  const sentence = pickFirstSentence(result);
  return sentence ? { ...result, explanationItems: [{ sentenceItems: [sentence] }] } : null;
};

// 展開後是否真的有比摘要更多的內容；沒有就不要放「看完整內容」，免得按了什麼都沒變。
export const hasMoreDetail = (result) => {
  if (!result) return false;
  if (Number(result.frequency) > 0 || result.sources?.length > 0 || result.variant || result.formationWord || result.derivativeRoot) return true;
  if (result.dictionaryNote?.replace(/[\r\n]+/g, '')) return true;
  const defs = result.explanationItems || [];
  if (defs.some((d) => d.englishExplanation?.trim() || d.category?.length > 0 || d.partOfSpeech?.length > 0 || d.focus?.length > 0)) return true;
  const sentences = defs.flatMap((d) => d.sentenceItems || []).filter((ex) => ex.originalSentence?.trim() || ex.chineseSentence?.trim());
  // 空的義項不算「更多內容」
  const filled = defs.filter((d) => d.chineseExplanation?.trim() || d.englishExplanation?.trim() || d.sentenceItems?.some((ex) => ex.originalSentence?.trim() || ex.chineseSentence?.trim()));
  return sentences.length > 1 || filled.length > 1;
};
