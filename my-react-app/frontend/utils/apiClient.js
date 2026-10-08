import axios from 'axios';
import { auth } from '../../firebase';

/**
 * 統一附加 Firebase ID token、統一解析錯誤訊息的 API 呼叫工具。
 *
 * 原本約 16 個呼叫點各自重寫 `const token = await auth.currentUser?.getIdToken()`，
 * 錯誤解析方式也分三種：axios 讀 err.response.data.detail、fetch 大多直接丟棄
 * 回傳內容只顯示通用訊息。這正是 review_AI.jsx 漏帶 token、sentenceSpeak.jsx
 * 漏檢查回應內容這兩個真實 bug的根本原因——沒有單一介面可以「附一次 token、
 * 統一解析錯誤」。
 *
 * 底層維持呼叫 axios.get/axios.post（而非 axios.request），刻意保留跟原本
 * 呼叫點完全相同的 config 形狀（{headers, params?, signal?}），既有測試
 * （label.test.jsx／result.test.jsx）直接 mock axios.post 斷言呼叫參數，
 * 不需要因為這次改用共用 client 而跟著更動。
 */
export class ApiError extends Error {
  constructor(message, { status, data, timedOut } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.timedOut = Boolean(timedOut);
  }
}

async function authHeaders() {
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 預設逾時：伺服器接了連線卻一直不回應時，頁面不該永遠停在載入中。
 * 影像辨識、翻譯、AI 出題都可能跑比較久，所以抓 60 秒（nginx 的 proxy_read_timeout 是 90 秒，
 * 要比它短，前端才會先顯示逾時訊息）；個別呼叫可以用 options.timeout 覆寫。 */
export const DEFAULT_TIMEOUT_MS = 60000;

function buildConfig(headers, { params, signal, timeout } = {}) {
  const config = { headers, timeout: timeout ?? DEFAULT_TIMEOUT_MS };
  if (params !== undefined) config.params = params;
  if (signal !== undefined) config.signal = signal;
  return config;
}

/** 把 detail／error 欄位轉成可讀字串。FastAPI 的 Pydantic 驗證失敗時，detail
 * 不是字串，而是錯誤物件陣列（[{type, loc, msg, input}, ...]）；直接把它交給
 * `new Error(message)`，JS 會用 String() 轉換，陣列裡的物件變成沒有意義的
 * "[object Object]"。這裡改成抓每一項的 msg 組成一句可讀訊息。 */
function extractMessage(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value
      .map((item) => (item && typeof item === 'object' && item.msg) || JSON.stringify(item))
      .join('；');
  }
  if (value && typeof value === 'object') {
    return value.msg || JSON.stringify(value);
  }
  return null;
}

function throwNormalizedError(err) {
  // 呼叫端可能仍用 axios.isCancel(err) 判斷主動中斷的請求（見 _camera/label.jsx），
  // 這種情況原樣往外丟，不包成 ApiError。
  if (axios.isCancel(err)) throw err;
  const status = err.response?.status;
  const respData = err.response?.data;
  // 後台 API 回 401 且 code 為 reauth_required：距離上次用密碼驗證太久。通知後台的重新驗證彈窗
  // （src/_admin/session/AdminReauthModal.jsx），錯誤照常往外丟，呼叫端的錯誤處理不變。
  if (status === 401 && respData?.code === 'reauth_required' && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('admin:reauth-required'));
  }
  const isTimeout = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT';
  const message = extractMessage(respData?.detail) || extractMessage(respData?.error)
    || (isTimeout ? '伺服器回應逾時，請稍後再試' : err.message) || '請求失敗';
  throw new ApiError(message, { status, data: respData, timedOut: isTimeout });
}

/** apiGet/apiPost/apiPut/apiPatch/apiDelete 的共用執行層：附加 token、呼叫、
 * 解析錯誤。GET/DELETE 與 POST/PUT/PATCH 的 axios 參數形狀不同（後者多一個
 * data 參數），刻意不用 method 字串工廠把這個差異藏起來——呼叫端傳入的
 * `request` callback 自己決定要怎麼呼叫對應的 axios method，這裡只負責
 * 「附一次 token、統一解析錯誤」這件跨 method 共用的事。 */
async function executeApi(options, request) {
  const headers = await authHeaders();
  try {
    const res = await request(buildConfig(headers, options));
    return res.data;
  } catch (err) {
    throwNormalizedError(err);
  }
}

/** data 可以是一般物件（JSON body）或 FormData（axios 會自動判斷、自動設定對應的 Content-Type）。*/
export function apiPost(url, data, options = {}) {
  return executeApi(options, (config) => axios.post(url, data, config));
}

/** 值得重試的暫時性失敗：連不到伺服器（沒有 response）、或閘道回 502/503/504。
 * 只有 GET 會自動重試（讀取是冪等的）；POST/PUT/PATCH/DELETE 重送可能造成重複寫入，一律不重試。 */
const RETRY_DELAY_MS = 600;
const isTransientFailure = (err) => {
  if (axios.isCancel(err)) return false;
  const status = err.response?.status;
  return status === undefined || status === 502 || status === 503 || status === 504;
};

export async function apiGet(url, options = {}) {
  const { retries = 1, ...requestOptions } = options;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await executeApi(requestOptions, (config) => axios.get(url, config));
    } catch (err) {
      const original = err?.cause ?? err;
      const transient = err instanceof ApiError
        ? (err.status === undefined || [502, 503, 504].includes(err.status)) && !err.timedOut
        : isTransientFailure(original);
      if (attempt >= retries || !transient || requestOptions.signal?.aborted) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
    }
  }
}

/** 後台管理系統的端點才會用到 PATCH／PUT／DELETE（見 backend/adminapi/），
 * 既有前台呼叫點目前都只用 GET/POST，所以原本沒有這幾個函式——補上時沿用
 * 跟 apiGet/apiPost 完全一樣的 token 附加與錯誤處理方式，不要另外長出一套。 */
export function apiPatch(url, data, options = {}) {
  return executeApi(options, (config) => axios.patch(url, data, config));
}

export function apiPut(url, data, options = {}) {
  return executeApi(options, (config) => axios.put(url, data, config));
}

export function apiDelete(url, options = {}) {
  return executeApi(options, (config) => axios.delete(url, config));
}

/** P5 數據分析用的輕量事件回報（頁面瀏覽、測驗開始/作答等）。
 *
 * 刻意不重用 apiPost——那個函式的錯誤處理是「解析成 ApiError 往外拋」，
 * 分析事件遺漏不該讓呼叫端多包一層 try/catch，也不該讓使用者看到任何
 * 提示：這裡直接吞掉所有失敗（網路離線、後端 429、任何例外），永遠不
 * reject，呼叫端可以放心地在任何地方直接呼叫 `trackEvent(...)` 而不用
 * await、不用 catch。tribe/payload 皆為選填。 */
export function trackEvent(eventType, { tribe, payload } = {}) {
  return apiPost('/adminapi/public/events/', { event_type: eventType, tribe, payload }).catch(() => {});
}
