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
  constructor(message, { status, data } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

async function authHeaders() {
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function buildConfig(headers, { params, signal } = {}) {
  const config = { headers };
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

function normalizeError(err) {
  // 呼叫端可能仍用 axios.isCancel(err) 判斷主動中斷的請求（見 _camera/label.jsx），
  // 這種情況原樣往外丟，不包成 ApiError。
  if (axios.isCancel(err)) throw err;
  const status = err.response?.status;
  const respData = err.response?.data;
  const message = extractMessage(respData?.detail) || extractMessage(respData?.error) || err.message || '請求失敗';
  throw new ApiError(message, { status, data: respData });
}

/** data 可以是一般物件（JSON body）或 FormData（axios 會自動判斷、自動設定對應的 Content-Type）。*/
export async function apiPost(url, data, options = {}) {
  const headers = await authHeaders();
  try {
    const res = await axios.post(url, data, buildConfig(headers, options));
    return res.data;
  } catch (err) {
    normalizeError(err);
  }
}

export async function apiGet(url, options = {}) {
  const headers = await authHeaders();
  try {
    const res = await axios.get(url, buildConfig(headers, options));
    return res.data;
  } catch (err) {
    normalizeError(err);
  }
}

/** 後台管理系統的端點才會用到 PATCH／PUT／DELETE（見 backend/adminapi/），
 * 既有前台呼叫點目前都只用 GET/POST，所以原本沒有這幾個函式——補上時沿用
 * 跟 apiGet/apiPost 完全一樣的 token 附加與錯誤處理方式，不要另外長出一套。 */
export async function apiPatch(url, data, options = {}) {
  const headers = await authHeaders();
  try {
    const res = await axios.patch(url, data, buildConfig(headers, options));
    return res.data;
  } catch (err) {
    normalizeError(err);
  }
}

export async function apiPut(url, data, options = {}) {
  const headers = await authHeaders();
  try {
    const res = await axios.put(url, data, buildConfig(headers, options));
    return res.data;
  } catch (err) {
    normalizeError(err);
  }
}

export async function apiDelete(url, options = {}) {
  const headers = await authHeaders();
  try {
    const res = await axios.delete(url, buildConfig(headers, options));
    return res.data;
  } catch (err) {
    normalizeError(err);
  }
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
