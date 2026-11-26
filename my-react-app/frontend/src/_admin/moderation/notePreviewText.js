/**
 * 分享筆記審核頁的摘要純文字轉換（FR-8d，原本 SharedNotesModeration.jsx／
 * ReportsQueue.jsx 各自重複一份）。
 *
 * preview 存的是筆記內文的原始 HTML（見 noteService.jsx 的 shareNote()），
 * 不用 dangerouslySetInnerHTML 呈現（避免 XSS），但也不能把原始 HTML 標籤
 * 原封不動當純文字顯示，否則審核者看到的是一堆 <span style="..."> 而不是
 * 筆記內容本身。這兩處呈現的是同一種資料、必須維持同一種轉換方式，所以
 * 抽成共用函式而不是各自維護一份。
 *
 * 只做「拿掉標籤」這一件事，不是通用的 HTML sanitizer——這裡只需要給
 * 管理頁看的摘要純文字。
 */
export const stripHtml = (value) => {
  const withoutTags = (value || '').replace(/<[^>]+>/g, ' ');

  // 稽核 FE7b-22：只拿掉標籤的話，審核者會看到 &amp;、&nbsp; 這類實體。用 DOMParser
  // 解析（不插入 DOM、不執行腳本，仍然安全）取 textContent 解碼，再壓縮連續空白。
  let decoded = withoutTags;
  if (typeof DOMParser !== 'undefined') {
    decoded = new DOMParser().parseFromString(withoutTags, 'text/html').documentElement.textContent ?? '';
  }

  return decoded.replace(/\s+/g, ' ').trim();
};

export default stripHtml;
