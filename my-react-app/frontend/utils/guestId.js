/**
 * 訪客翻譯試用用的瀏覽器代號（C-3）。
 *
 * 後端用它（連同來源 IP）做每日次數控管，只存雜湊值。它只是一個隨機字串，不含任何個人資料，
 * 也不是登入憑證；清除瀏覽器資料就會換新的。格式要和後端 fastAPI/guest_trial.py 的
 * 驗證一致：英數字、底線、連字號，長度 16 到 64。
 *
 * localStorage 在無痕視窗或被封鎖時可能拋例外，這時退回只存在這次頁面載入的記憶體代號：
 * 功能照常可用，只是每次重新整理都會被當成新的瀏覽器（每 IP 的保險上限仍然有效）。
 */
const STORAGE_KEY = 'yy_guest_id';
const VALID_ID = /^[A-Za-z0-9_-]{16,64}$/;

let memoryId = null;

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getGuestId() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && VALID_ID.test(stored)) return stored;
  } catch {
    // 讀不到就往下產生新的
  }
  if (memoryId) return memoryId;
  const fresh = generateId();
  try {
    window.localStorage.setItem(STORAGE_KEY, fresh);
  } catch {
    memoryId = fresh;
  }
  return fresh;
}

export const GUEST_ID_HEADER = 'X-Guest-Id';
