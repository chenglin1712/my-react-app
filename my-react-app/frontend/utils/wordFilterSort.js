import { frequencyToStarCount } from './frequencyStars';

/**
 * 詞條清單的篩選＋排序邏輯單一資料來源。
 *
 * 原本 _search/index.jsx 與 _camera/result.jsx 各自維護一份幾乎相同的
 * filterAndSortWords：_search 版本後來修好了排序時非字母前綴（-、ʼ 等）的
 * 處理（跳過前綴取字母部分排序、純非字母開頭一律排最後），camera 版本沒跟上
 * （只特別處理了單引號 "'"），同一份資料在兩個頁面排序結果會不一致。
 * 抽成共用函式後兩邊都改吃這裡，之後排序邏輯只需要改一個地方。
 */
// 跳過非字母前綴（-、ʼ、' 等），取第一個字母作為排序依據。
const getAlphabeticSortKey = (s) => s.replace(/^[^a-z]+/, '') || s;

/**
 * 建立詞條名稱的排序 comparator。
 *
 * 非字母開頭的詞條（如 -a、-an）在 asc（由 A 到 Z）時排在最後；desc 是 asc
 * 的完整反轉（包含這些前綴詞的位置），不是「前綴詞永遠固定在最後」——目前
 * 唯一呼叫端（wordFilterSort 本身的排序流程）就是靠反轉整個比較結果做到 desc，
 * 這裡沿用同一份既有行為，沒有另外變更。
 */
function createWordComparator(sortOrder) {
  return (a, b) => {
    const aFirst = (a.name || '').toLowerCase();
    const bFirst = (b.name || '').toLowerCase();

    const aKey = getAlphabeticSortKey(aFirst);
    const bKey = getAlphabeticSortKey(bFirst);

    const aIsPrefix = /^[^a-z]/.test(aFirst);
    const bIsPrefix = /^[^a-z]/.test(bFirst);

    if (sortOrder === 'asc') {
      if (aIsPrefix && !bIsPrefix) return 1;
      if (!aIsPrefix && bIsPrefix) return -1;
      return aKey.localeCompare(bKey, undefined, { sensitivity: 'base' }) || aFirst.localeCompare(bFirst, undefined, { sensitivity: 'base' });
    }

    if (aIsPrefix && !bIsPrefix) return -1;
    if (!aIsPrefix && bIsPrefix) return 1;
    return bKey.localeCompare(aKey, undefined, { sensitivity: 'base' }) || bFirst.localeCompare(aFirst, undefined, { sensitivity: 'base' });
  };
}

// 詞類篩選（Apple 化步驟 4-2）：詞條的任一個詞義的詞性等於所選值就算符合
const hasPartOfSpeech = (word, pos) => (word.explanationItems ?? []).some((def) => typeof def.partOfSpeech === 'string' && def.partOfSpeech.trim() === pos);

/** 從已載入的詞條收集實際出現的詞性（依出現次數多到少，同次數依字串排序），給詞類篩選的選項用；不寫死詞類清單。 */
export function collectPartsOfSpeech(words) {
  const counts = new Map();
  for (const w of words) {
    const seen = new Set((w.explanationItems ?? []).map((d) => (typeof d.partOfSpeech === 'string' ? d.partOfSpeech.trim() : '')).filter(Boolean));
    seen.forEach((pos) => counts.set(pos, (counts.get(pos) ?? 0) + 1));
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([pos, count]) => ({ pos, count }));
}

export function filterAndSortWords(words, {
  filterLetter = '',
  frequencyFilter = '',
  showOnlyFavorites = false,
  favoriteWords,
  selectedSubCategory = null,
  partOfSpeech = '',
  sortOrder = 'asc',
} = {}) {
  return words
    .filter((w) => {
      const wordName = (w.name || '').toLowerCase();
      const matchesLetter = !filterLetter || wordName.startsWith(filterLetter);
      const isFavorite = favoriteWords?.has(w.name);

      const starCount = frequencyToStarCount(w.frequency);
      const matchesFrequency = !frequencyFilter || starCount === parseInt(frequencyFilter, 10);

      const matchesCategory =
        !selectedSubCategory ||
        (w.explanationItems?.some((def) => def.category?.includes(selectedSubCategory)) ||
          w.category === selectedSubCategory);

      const matchesPos = !partOfSpeech || hasPartOfSpeech(w, partOfSpeech);

      return matchesLetter && (!showOnlyFavorites || isFavorite) && matchesFrequency && matchesCategory && matchesPos;
    })
    .sort(createWordComparator(sortOrder));
}

// 完全符合與相關符合的總筆數（結果結構：完全符合 { 詞: [條目] }，相關符合 { 詞: { 分類: [條目] } }），
// 給螢幕報讀器公告「找到幾筆」用。
export function countMatchedWords(exactMatches = {}, fuzzyMatches = {}) {
  const exact = Object.values(exactMatches || {}).flat().length;
  const fuzzy = Object.values(fuzzyMatches || {}).reduce(
    (sum, group) => sum + Object.values(group || {}).flat().length,
    0,
  );
  return exact + fuzzy;
}
