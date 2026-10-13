// 給螢幕報讀器的動態訊息公告（審查項 P2-99）。
//
// 為什麼要集中處理：aria-live 區塊必須「先存在於頁面上、之後才改內容」才會被念出來。
// 元件自己臨時渲染出一個 role="status" 的 <p>，很多報讀器不會念；而且各處各寫一套，
// 該公告的（收藏切換、切題、篩選結果數）又常常漏掉。
// 全站只在 AppShell 放一組常駐的 <LiveAnnouncer />，任何地方呼叫 announce() 就會被念出。
//
// 用法：
//   announce("已加入收藏");                              // 一般狀態：不打斷目前正在念的內容
//   announce("收藏失敗，請稍後再試。", { assertive: true });  // 錯誤：立刻插話
// 錯誤訊息如果本來就顯示在畫面上，直接給那個元素 role="alert" 即可，不用再 announce 一次。
export const ANNOUNCE_EVENT = "yy:announce";

export function announce(message, { assertive = false } = {}) {
  if (typeof window === "undefined" || !message) return;
  window.dispatchEvent(new CustomEvent(ANNOUNCE_EVENT, { detail: { message: String(message), assertive } }));
}
