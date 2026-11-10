// 與 .env.example 的 VITE_API_FAVORITES_SUMMARY_URL 一致
export const DEFAULT_FAVORITES_SUMMARY_URL = '/api/v1/dictionary/favorites-summary/';

// 部署機的 .env 若漏了這個變數（undefined、空字串、只有空白），不能讓請求打到 "/undefined"（405 且 console 報錯）。
export const resolveFavoritesSummaryUrl = (value) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || DEFAULT_FAVORITES_SUMMARY_URL;
};
