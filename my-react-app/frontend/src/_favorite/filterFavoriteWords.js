import { filterAndSortWords } from "../../utils/wordFilterSort";

// 這裡原本叫 useFilterAndSort 放在 hooks/ 底下，但內部完全沒有用到任何 React
// hook，只是一般的資料處理函式——名稱與位置都在暗示它是 hook，容易誤導，
// 改成普通函式並搬出 hooks/ 目錄。
function matchSearchCriteria(wordObj, query) {
  if (!query) return true;
  const lowerQuery = query.toLowerCase();
  const headword = (wordObj.name || '').toLowerCase();
  const defins = wordObj.explanationItems || [];

  // 只需要看 defins.some(...)：它本身就涵蓋了「第一筆義項是否符合」的情況，
  // 不需要額外多算一次第一筆的 chineseExplanation。
  return (
    headword.includes(lowerQuery) ||
    defins.some(def => (def.chineseExplanation || '').toLowerCase().includes(lowerQuery))
  );
}

// contentIds（收藏分類的內容）跟搜尋文字這兩項篩選是收藏頁特有的，篩過後
// 交給 utils/wordFilterSort.js 的共用函式處理開頭字母／詞頻／分類篩選與排序，
// 跟搜尋頁、相機頁使用同一套排序規則（含 -、ʼ 前綴修正）。
export function filterFavoriteWords(allWords, contentIds, state, selectedSubCategory) {
  const inTab = allWords.filter(
    (w) => contentIds.includes(w.name) && matchSearchCriteria(w, state.activeQuery)
  );
  return filterAndSortWords(inTab, {
    filterLetter: state.filterLetter,
    frequencyFilter: state.frequencyFilter,
    selectedSubCategory,
    sortOrder: state.sortOrder,
  });
}
