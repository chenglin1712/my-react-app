import { filterAndSortWords } from "../../../utils/wordFilterSort";

//篩選和排序功能
export const useFilterAndSort = (allWords) => {
  const matchSearchCriteria = (wordObj, query) => {
    if (!query) return true;
    const lowerQuery = query.toLowerCase();
    const tayal = (wordObj.name || '').toLowerCase();
    const defins = wordObj.explanationItems || [];
    const ch = defins.length > 0 ? (defins[0].chineseExplanation || '').toLowerCase() : '';

    return (
      tayal.includes(lowerQuery) ||
      ch.includes(lowerQuery) ||
      defins.some(def => (def.chineseExplanation || '').toLowerCase().includes(lowerQuery))
    );
  };

  // contentIds（收藏分類的內容）跟搜尋文字這兩項篩選是收藏頁特有的，篩過後
  // 交給 utils/wordFilterSort.js 的共用函式處理開頭字母／詞頻／分類篩選與排序，
  // 跟搜尋頁、相機頁使用同一套排序規則（含 -、ʼ 前綴修正）。
  const filterAndSort = (contentIds, state, selectedSubCategory) => {
    const inTab = allWords.filter(
      (w) => contentIds.includes(w.name) && matchSearchCriteria(w, state.activeQuery)
    );
    return filterAndSortWords(inTab, {
      filterLetter: state.filterLetter,
      frequencyFilter: state.frequencyFilter,
      selectedSubCategory,
      sortOrder: state.sortOrder,
    });
  };

  return filterAndSort;
};
