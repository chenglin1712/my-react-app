// 結算頁慶祝的達標判斷（Apple 化步驟 4-5）：成績 60% 以上才慶祝，與句型遊戲既有的「不錯」分級一致。
export const CELEBRATE_MIN_PCT = 60;
export const shouldCelebrate = (pct) => Number.isFinite(pct) && pct >= CELEBRATE_MIN_PCT;
