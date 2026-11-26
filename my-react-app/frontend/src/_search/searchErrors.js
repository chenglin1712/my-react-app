import { apiUrl } from '../../utils/apiUrls';

// 單詞查詢的錯誤分類（稽核 FE3-01）。原本任何失敗都顯示「查詢失敗，請稍後再試」，再附一顆重試鈕：
// 訪客被限流、登入過期、後端掛掉看起來都一樣，重試也不一定有用。這裡依狀態碼分成幾種，
// 畫面據此給不同的說明與下一步。「查無結果」不是錯誤，由頁面的空狀態處理，不會走到這裡。

export const SEARCH_ERROR_KIND = Object.freeze({
  RATE_LIMITED: 'rate_limited',
  AUTH: 'auth',
  UNAVAILABLE: 'unavailable',
  INVALID: 'invalid',
});

/** action：'search'（主查詢）或 'loadMore'（載入更多），只影響訊息開頭。 */
export function describeSearchError(err, { action = 'search' } = {}) {
  const status = err?.status;
  const what = action === 'loadMore' ? '載入更多' : '查詢';
  if (status === 429) {
    return {
      kind: SEARCH_ERROR_KIND.RATE_LIMITED,
      message: `${what}次數太多，請稍候約一分鐘再試。未登入時的查詢額度較少，登入後可以查更多次。`,
      retryable: true,
    };
  }
  if (status === 401 || status === 403) {
    // 公開的查詢端點只有在「帶了登入憑證但驗證失敗」時才會回 401（訪客不會）：多半是登入過期
    return { kind: SEARCH_ERROR_KIND.AUTH, message: '登入狀態已失效，請重新登入後再查詢。', retryable: false };
  }
  if (status === 400 || status === 422) {
    return { kind: SEARCH_ERROR_KIND.INVALID, message: `${what}條件有誤，請修改後再試。`, retryable: false };
  }
  // 5xx、逾時、連不上：都是服務端或網路的暫時狀況，不把內部訊息顯示出來
  return { kind: SEARCH_ERROR_KIND.UNAVAILABLE, message: `辭典服務暫時無法使用，請稍後再試。`, retryable: true };
}

/** 稽核 FE3-04：查詢建議專用端點（不記搜尋事件、跟正式查詢分開限流）。
 * 跟 SEARCH_KEY 放在同一層路徑，從它推出來，部署時不必多設一個環境變數。 */
export const suggestUrl = () => apiUrl('SEARCH_KEY').replace(/key\/?$/, 'suggest/');
