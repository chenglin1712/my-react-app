import { auth } from "../../firebase";

/**
 * <audio src> 和 `new Audio(url)` 都無法附加 Authorization header，
 * 但 /dictionary/audio/{id} 現在需要登入才能存取。
 * 這裡改用 fetch 帶 Bearer token 把音檔內容抓下來，轉成 blob URL 後再交給 Audio 元素播放，
 * 並在播放結束或發生錯誤時自動 revoke，避免 blob URL 累積造成記憶體洩漏。
 */
export async function createAuthorizedAudio(url) {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error(`音檔載入失敗：HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const audioEl = new Audio(objectUrl);
  let revoked = false;
  const revoke = () => {
    if (revoked) return;
    revoked = true;
    URL.revokeObjectURL(objectUrl);
  };
  audioEl.addEventListener("ended", revoke, { once: true });
  audioEl.addEventListener("error", revoke, { once: true });
  // 呼叫端手動中斷播放去切下一首（例如快速連續點擊）時只會呼叫 pause()，
  // 不會觸發 ended/error，blob URL 不會被上面兩個監聽器釋放，長期下來會
  // 累積記憶體洩漏。呼叫端要自己在 pause() 的同時呼叫這個方法才會釋放。
  audioEl.revokeObjectUrl = revoke;
  return audioEl;
}
