/**
 * 詞頻數值 -> 星等（1~5）的門檻規則單一資料來源。
 *
 * 原本這條規則寫死在 3 個地方：WordCard.jsx／_favorite/index.jsx 各自的星星
 * 渲染元件，以及 wordFilterSort.js 篩選詞頻時的星等換算——目前三處門檻值一致，
 * 但同一條業務規則被複製了 3 遍，改一個門檻值容易漏改其中一處。
 */
export function frequencyToStarCount(fre) {
  const value = fre ?? 0;
  if (value >= 0 && value <= 200) return 1;
  if (value <= 400) return 2;
  if (value <= 800) return 3;
  if (value <= 1000) return 4;
  return 5;
}
