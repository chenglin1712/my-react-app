import axios from 'axios';
import { auth } from '../../firebase';
import { forgetGuestToken, getGuestToken, GUEST_TOKEN_HEADER, GUEST_TOKEN_INVALID_CODE } from './guestToken';

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

async function authHeaders(guest) {
  const token = await auth.currentUser?.getIdToken();
  if (token) return { Authorization: `Bearer ${token}` };
  if (!guest) return {};
  // 沒登入、且呼叫端明確標示 guest（訪客翻譯試用）才帶後端核發的訪客憑證；其他請求不帶，避免到處送出憑證。
  // 領取失敗（這個網路今天領太多、訪客試用沒開放、連不上）時，把後端的訊息原樣交給呼叫端。
  try {
    return { [GUEST_TOKEN_HEADER]: await getGuestToken() };
  } catch (err) {
    throwNormalizedError(err);
  }
}

const isGuestTokenRejected = (err) =>
  err?.response?.status === 401 && err.response.data?.code === GUEST_TOKEN_INVALID_CODE;

/** 預設逾時：伺服器接了連線卻一直不回應時，頁面不該永遠停在載入中。
 * 影像辨識、翻譯、AI 出題都可能跑比較久，所以抓 60 秒（nginx 的 proxy_read_timeout 是 90 秒，
 * 要比它短，前端才會先顯示逾時訊息）；個別呼叫可以用 options.timeout 覆寫。 */
export const DEFAULT_TIMEOUT_MS = 60000;

function buildConfig(headers, { params, signal, timeout, onUploadProgress } = {}) {
  const config = { headers, timeout: timeout ?? DEFAULT_TIMEOUT_MS };
  if (params !== undefined) config.params = params;
  if (signal !== undefined) config.signal = signal;
  if (onUploadProgress !== undefined) config.onUploadProgress = onUploadProgress;
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

function throwNormalizedError(rawErr) {
  // 被丟出來的不一定是物件（null、字串）：先轉成 Error，避免讀屬性時再丟 TypeError 蓋掉原始錯誤
  const err = rawErr && typeof rawErr === 'object' ? rawErr : new Error(String(rawErr ?? '請求失敗'));
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
  const headers = await authHeaders(options?.guest);
  try {
    const res = await request(buildConfig(headers, options));
    return res.data;
  } catch (err) {
    // 訪客憑證被後端拒絕（過期、簽章不符、舊版代號）：丟掉那一張、換領新的，只重送這一次。
    // 其他 401（例如登入過期）不處理。這裡的 POST 重送是安全的：憑證驗證發生在扣額度與任何翻譯之前。
    const rejected = headers[GUEST_TOKEN_HEADER];
    if (rejected && isGuestTokenRejected(err)) {
      forgetGuestToken(rejected);
      const retryHeaders = await authHeaders(options?.guest);
      try {
        const res = await request(buildConfig(retryHeaders, options));
        return res.data;
      } catch (retryErr) {
        throwNormalizedError(retryErr);
      }
    }
    throwNormalizedError(err);
  }
}

/** data 可以是一般物件（JSON body）或 FormData（axios 會自動判斷、自動設定對應的 Content-Type）。*/
export function apiPost(url, data, options = {}) {
  return executeApi(options, (config) => axios.post(url, data, config));
}

/** 串流中途多久沒收到任何資料就當作斷線（毫秒）。伺服器在查辭典或等模型時可能十幾秒沒有新文字，
 * 所以比一般逾時寬鬆，但要比後端的串流總期限（55 秒）短，卡住的連線才不會讓畫面一直停在回覆中。 */
export const STREAM_IDLE_TIMEOUT_MS = 40000;

/** 把一段 SSE 文字（可能含多個以空行分隔的事件）拆成 [{event, data}]；回傳剩下尚未收完整的片段。 */
function parseSse(buffer) {
  const events = [];
  let rest = buffer;
  for (let end = rest.indexOf('\n\n'); end !== -1; end = rest.indexOf('\n\n')) {
    const block = rest.slice(0, end);
    rest = rest.slice(end + 2);
    let event = 'message';
    const dataLines = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (!dataLines.length) continue;
    try {
      events.push({ event, data: JSON.parse(dataLines.join('\n')) });
    } catch {
      // 壞掉的事件略過；少一個片段不該讓整段回覆失敗，最後的 done 事件會帶完整文字
    }
  }
  return { events, rest };
}

/**
 * POST 後以 Server-Sent Events 讀取串流回覆（AI 助手，路線圖 #9）。
 *
 * 用 fetch 而不是 axios：瀏覽器端的 axios 讀不到逐段到達的回應本體。token 與 ApiError 的形狀
 * 沿用 apiPost，呼叫端的錯誤處理（status、data.code）不用分兩套。
 *
 * - onDelta(text)：每收到一段文字就呼叫。
 * - 成功時回傳 done 事件的內容（完整文字、簽章、額度…）。
 * - 開始串流前的錯誤（401、403、429、400…）是一般 JSON，丟出帶 status 與 data 的 ApiError。
 * - 串流中途的 error 事件、斷線、閒置逾時，丟出 ApiError；error.partial 為 true 代表已經收到過部分文字。
 * - 呼叫端用 options.signal 中止時，原樣丟出 AbortError，由呼叫端判斷是使用者按了停止還是離開頁面。
 */
export async function apiStream(url, data, { signal, onDelta, idleTimeoutMs = STREAM_IDLE_TIMEOUT_MS } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(await authHeaders()) };

  // 內部的 controller 同時服務「呼叫端中止」與「閒置逾時」；兩者要分得出來，所以逾時用自己的旗標
  const controller = new AbortController();
  let idleTimedOut = false;
  let idleTimer;
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { idleTimedOut = true; controller.abort(); }, idleTimeoutMs);
  };
  const onCallerAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  let received = false;
  let reader;
  try {
    armIdle();
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(data), signal: controller.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      throw new ApiError(extractMessage(body?.detail) || extractMessage(body?.error) || '請求失敗', { status: response.status, data: body });
    }
    if (!response.body) throw new ApiError('瀏覽器不支援串流回應', { status: response.status });

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // SSE 的換行可以是 \n、\r\n 或單獨的 \r，而且 \r 與 \n 可能被切在兩個封包。結尾的 \r 先留到下一個封包，
    // 才分得出它是單獨的換行還是 \r\n 的前半；否則 \r 變成 \n 之後再接一個 \n，會多出一個假的事件分隔。
    let heldCarriageReturn = '';
    const normalize = (text) => {
      let joined = heldCarriageReturn + text;
      heldCarriageReturn = '';
      if (joined.endsWith('\r')) {
        heldCarriageReturn = '\r';
        joined = joined.slice(0, -1);
      }
      return joined.replace(/\r\n|\r/g, '\n');
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += normalize(decoder.decode()) + heldCarriageReturn.replace('\r', '\n');
        break;
      }
      armIdle();
      buffer += normalize(decoder.decode(value, { stream: true }));
      const parsed = parseSse(buffer);
      buffer = parsed.rest;
      for (const { event, data: payload } of parsed.events) {
        if (event === 'delta') {
          received = true;
          onDelta?.(payload.t);
        } else if (event === 'done') {
          return payload;
        } else if (event === 'error') {
          const err = new ApiError(payload.detail || '回覆中斷', { status: payload.status, data: payload });
          err.partial = received;
          throw err;
        }
      }
    }
    // 連線結束卻沒有 done：不能把半截文字當成完整回覆（結尾殘留的最後一個事件先解析，它可能就是 done）
    for (const { event, data: payload } of parseSse(`${buffer}\n\n`).events) {
      if (event === 'done') return payload;
    }
    const err = new ApiError('回覆中斷', { data: { interrupted: true } });
    err.partial = received;
    throw err;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (idleTimedOut) {
      const timeout = new ApiError('伺服器太久沒有回應，請重試', { timedOut: true, data: { interrupted: true } });
      timeout.partial = received;
      throw timeout;
    }
    if (signal?.aborted) throw err;
    const failure = new ApiError(err.message || '網路連線中斷', { data: { interrupted: true } });
    failure.partial = received;
    throw failure;
  } finally {
    clearTimeout(idleTimer);
    signal?.removeEventListener('abort', onCallerAbort);
    // 收到 done 就結束時連線可能還開著（代理延遲關閉等）：主動取消，把連線還給瀏覽器
    reader?.cancel?.()?.catch?.(() => {});
  }
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

/** P5 資料分析用的輕量事件回報（頁面瀏覽、測驗開始/作答等）。
 *
 * 刻意不重用 apiPost——那個函式的錯誤處理是「解析成 ApiError 往外拋」，
 * 分析事件遺漏不該讓呼叫端多包一層 try/catch，也不該讓使用者看到任何
 * 提示：這裡直接吞掉所有失敗（網路離線、後端 429、任何例外），永遠不
 * reject，呼叫端可以放心地在任何地方直接呼叫 `trackEvent(...)` 而不用
 * await、不用 catch。tribe/payload 皆為選填。 */
export function trackEvent(eventType, { tribe, payload } = {}) {
  return apiPost('/adminapi/public/events/', { event_type: eventType, tribe, payload }).catch(() => {});
}
