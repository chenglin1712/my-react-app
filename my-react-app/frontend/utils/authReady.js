import { auth } from '../../firebase';

/** 等多久還原不出登入狀態就放棄（毫秒）：IndexedDB 被擋、無痕模式等情況下不能讓請求永遠卡住。 */
export const AUTH_READY_TIMEOUT_MS = 3000;

/**
 * 等 Firebase 把「上次的登入狀態」還原完。重新整理或直接開網址時，auth.currentUser 在還原完成前一律是 null，
 * 這時送出的請求不會帶 Authorization，後端回 401（辭典搜尋、翻譯能力查詢都會中）。
 * 沒登入的人會很快 resolve；不支援 authStateReady 的環境（測試替身等）直接略過。
 */
export async function waitForAuthReady() {
  let timer;
  try {
    const ready = auth?.authStateReady?.();
    if (!ready) return;
    await Promise.race([
      ready,
      new Promise((resolve) => { timer = setTimeout(resolve, AUTH_READY_TIMEOUT_MS); }),
    ]);
  } catch {
    // 還原失敗就當作沒登入，後續照原本的流程
  } finally {
    clearTimeout(timer);
  }
}
