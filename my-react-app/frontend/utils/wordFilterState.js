/** 篩選列的狀態輔助函式（從 WordFilterControls 元件檔拆出來，元件檔只匯出元件）。 */
export const FREQUENCY_LEVELS = [1, 2, 3, 4, 5];

/** 目前套用了幾個篩選條件（開頭字母、詞頻、只顯示收藏，另加分類等外部條件）。排序不算篩選。 */
export function countActiveFilters({ filterLetter, frequencyFilter, showOnlyFavorites, extra = 0 }) {
  return (filterLetter ? 1 : 0) + (String(frequencyFilter ?? '') ? 1 : 0) + (showOnlyFavorites ? 1 : 0) + extra;
}

/** 目前套用的條件，轉成給人看的短句（空狀態、「清除篩選」旁的說明用）。 */
export function describeActiveFilters({ filterLetter, frequencyFilter, showOnlyFavorites, selectedSubCategory }) {
  const parts = [];
  if (filterLetter) parts.push(`開頭「${filterLetter}」`);
  if (String(frequencyFilter ?? '')) parts.push(`詞頻 ${frequencyFilter} 星`);
  if (showOnlyFavorites) parts.push('只顯示收藏');
  if (selectedSubCategory) parts.push(`分類「${selectedSubCategory}」`);
  return parts;
}
