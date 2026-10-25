/**
 * 訪客翻譯試用用的憑證（S-01，取代原本前端自己產生的 guestId）。
 *
 * 憑證由後端核發並簽章（g1.<代號>.<到期 unix 秒>.<簽章>），前端自造的字串驗不過簽章。
 * 它是匿名的、不含個人資料，也不是登入憑證；清除瀏覽器資料就會再領一張新的。
 *
 * - 沒有憑證、憑證格式不對或已到期：向後端領一張（後端對每個網路每天有核發上限）。
 * - 剩不到 3 天：帶著舊憑證請後端續期（沿用同一個代號，當天已用的次數不會被重置）；續期失敗就繼續用舊的。
 * - 同時有多個請求需要憑證時共用同一次領取（single-flight），不會同時核發好幾張。
 * - 後端說憑證無效（401 + guest_token_invalid）時，只在儲存的憑證「仍然等於被拒絕的那一張」才刪除，
 *   避免把另一個請求剛領到的新憑證誤刪。
 *
 * localStorage 在無痕視窗或被封鎖時可能拋例外，這時退回只存在這次頁面載入的記憶體：功能照常可用，
 * 只是每次重新整理都要重領（核發上限仍然有效）。
 */
import axios from 'axios';

export const GUEST_TOKEN_HEADER = 'X-Guest-Token';
export const GUEST_TOKEN_INVALID_CODE = 'guest_token_invalid';

const STORAGE_KEY = 'yy_guest_token';
const TOKEN_SHAPE = /^g1\.[A-Za-z0-9_-]{16,64}\.[0-9]{1,12}\.[0-9a-f]{32}$/;
const RENEW_WITHIN_MS = 3 * 24 * 60 * 60 * 1000;
const ISSUE_TIMEOUT_MS = 15000;

// 沒設定環境變數時，從翻譯網址推出核發網址（同一個 router 底下的 /guest-token）。
const TRANSLATE_URL = import.meta.env.VITE_API_TRANSLATE_URL || '/api/v1/translation/translate';
const ISSUE_URL = import.meta.env.VITE_API_TRANSLATE_GUEST_TOKEN_URL
  || TRANSLATE_URL.replace(/\/translate\/?$/, '/guest-token');

let memoryToken = null;
let inFlight = null;

function expiresAtMs(token) {
  return Number(token.split('.')[2]) * 1000;
}

function usable(token, now) {
  return typeof token === 'string' && TOKEN_SHAPE.test(token) && expiresAtMs(token) > now;
}

function readStored() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
  } catch {
    // 讀不到就看記憶體
  }
  return memoryToken;
}

function store(token) {
  memoryToken = null;
  try {
    window.localStorage.setItem(STORAGE_KEY, token);
  } catch {
    memoryToken = token;
  }
}

/** 後端拒絕了某一張憑證：只有儲存的仍是那一張才刪。 */
export function forgetGuestToken(rejected) {
  if (readStored() !== rejected) return;
  memoryToken = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 無法刪除也沒關係：下一次用到時格式或到期檢查會再擋掉
  }
}

async function requestToken(current) {
  const headers = current ? { [GUEST_TOKEN_HEADER]: current } : {};
  const res = await axios.post(ISSUE_URL, null, { headers, timeout: ISSUE_TIMEOUT_MS });
  const token = res.data?.token;
  if (!usable(token, Date.now())) throw new Error('伺服器回傳的訪客憑證格式不正確');
  // compare-and-set：等待回應的期間，別的分頁可能已經存了一張可用的憑證；後到的回應不能蓋掉它，
  // 否則兩個分頁會各持不同身分。續期時只在儲存的仍是當初送出的那一張才換。
  const latest = readStored();
  if (latest !== current && usable(latest, Date.now())) return latest;
  store(token);
  return token;
}

/** 取得可用的訪客憑證；必要時向後端領取或續期。領取失敗時丟出 axios 的錯誤（含 response），由呼叫端轉成訊息。 */
export function getGuestToken() {
  const now = Date.now();
  const stored = readStored();
  const valid = usable(stored, now) ? stored : null;
  if (valid && expiresAtMs(valid) - now > RENEW_WITHIN_MS) return Promise.resolve(valid);

  if (!inFlight) {
    inFlight = requestToken(valid)
      .catch((err) => {
        // 續期失敗但舊憑證還能用：繼續用舊的，不讓一次網路問題擋下翻譯
        if (valid) return valid;
        throw err;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

/** 測試用：清掉模組內的記憶體狀態。 */
export function resetGuestTokenForTests() {
  memoryToken = null;
  inFlight = null;
}
