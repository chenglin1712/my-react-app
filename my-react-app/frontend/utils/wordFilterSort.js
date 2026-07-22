/**
 * 詞條清單的篩選＋排序邏輯單一資料來源。
 *
 * 原本 _search/index.jsx 與 _camera/result.jsx 各自維護一份幾乎相同的
 * filterAndSortWords：_search 版本後來修好了排序時非字母前綴（-、ʼ 等）的
 * 處理（跳過前綴取字母部分排序、純非字母開頭一律排最後），camera 版本沒跟上
 * （只特別處理了單引號 "'"），同一份資料在兩個頁面排序結果會不一致。
 * 抽成共用函式後兩邊都改吃這裡，之後排序邏輯只需要改一個地方。
 */
export function filterAndSortWords(words, {
  filterLetter = '',
  frequencyFilter = '',
  showOnlyFavorites = false,
  favoriteWords,
  selectedSubCategory = null,
  sortOrder = 'asc',
} = {}) {
  return words
    .filter((w) => {
      const tayal = (w.name || '').toLowerCase();
      const matchesLetter = !filterLetter || tayal.startsWith(filterLetter);
      const isFavorite = favoriteWords?.has(w.name);

      const fre = w.frequency || '';
      let starCount = 0;
      if (fre >= 0 && fre <= 200) starCount = 1;
      else if (fre <= 400) starCount = 2;
      else if (fre <= 800) starCount = 3;
      else if (fre <= 1000) starCount = 4;
      else starCount = 5;
      const matchesFrequency = !frequencyFilter || starCount === parseInt(frequencyFilter, 10);

      const matchesCategory =
        !selectedSubCategory ||
        (w.explanationItems?.some((def) => def.category?.includes(selectedSubCategory)) ||
          w.category === selectedSubCategory);

      return matchesLetter && (!showOnlyFavorites || isFavorite) && matchesFrequency && matchesCategory;
    })
    .sort((a, b) => {
      const aFirst = (a.name || '').toLowerCase();
      const bFirst = (b.name || '').toLowerCase();

      // 跳過非字母前綴（-、ʼ、' 等），取第一個字母作為排序依據
      const getKey = (s) => s.replace(/^[^a-z]+/, '') || s;
      const aKey = getKey(aFirst);
      const bKey = getKey(bFirst);

      // 純非字母開頭的詞條（如 -a、-an）排在最後
      const aIsPrefix = /^[^a-z]/.test(aFirst);
      const bIsPrefix = /^[^a-z]/.test(bFirst);

      if (sortOrder === 'asc') {
        if (aIsPrefix && !bIsPrefix) return 1;
        if (!aIsPrefix && bIsPrefix) return -1;
        return aKey.localeCompare(bKey, undefined, { sensitivity: 'base' }) || aFirst.localeCompare(bFirst, undefined, { sensitivity: 'base' });
      } else {
        if (aIsPrefix && !bIsPrefix) return -1;
        if (!aIsPrefix && bIsPrefix) return 1;
        return bKey.localeCompare(aKey, undefined, { sensitivity: 'base' }) || bFirst.localeCompare(aFirst, undefined, { sensitivity: 'base' });
      }
    });
}
