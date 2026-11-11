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
 * 詞條名稱的排序規則。
 *
 * 非字母開頭的詞條（如 -a、-an）在 asc（由 A 到 Z）時排在最後；desc 是 asc
 * 的完整反轉（包含這些前綴詞的位置），不是「前綴詞永遠固定在最後」。
 */
// 排序規則與後端 backend/fastAPI/routes/dictionary/search.py 的 _sort_key_name 完全相同：
// 排序鍵是 (是否非字母開頭, 去掉前綴後的字母部分, 小寫全名)，字串依字元碼點逐一比較，
// 不使用 localeCompare／Intl.Collator——語系排序會把標點、重音符號另外處理，
// 與後端的碼點排序在名稱中間有標點時會不同（例如 a-b 與 a'ba）。
// 兩邊共用的樣本在 shared/word_sort_cases.json，前後端測試都用它驗證，改規則時要一起改。
// （名稱只含基本多文種平面的字元，JS 字串的 UTF-16 單元比較與 Python 的碼點比較結果相同。）
const compareCodePoints = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

// 排序鍵（小寫名稱、去前綴的字母部分、是否非字母開頭）每個詞只算一次，
// 不要在 comparator 裡每次比較都對兩邊重算一遍（decorate-sort-undecorate）。
function toSortEntry(word) {
  const first = (word.name || '').toLowerCase();
  return { word, first, key: getAlphabeticSortKey(first), isPrefix: /^[^a-z]/.test(first) };
}

function compareAscending(a, b) {
  if (a.isPrefix !== b.isPrefix) return a.isPrefix ? 1 : -1;
  return compareCodePoints(a.key, b.key) || compareCodePoints(a.first, b.first);
}

/** 依詞條名稱排序（回傳新陣列，不改動輸入）。desc 是 asc 結果整個反過來（與後端 _sort_words 相同）。 */
export function sortWordsByName(words, sortOrder) {
  const ascending = words.map(toSortEntry).sort(compareAscending).map((entry) => entry.word);
  return sortOrder === 'desc' ? ascending.reverse() : ascending;
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
  const matched = words
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
    });
  return sortWordsByName(matched, sortOrder);
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
