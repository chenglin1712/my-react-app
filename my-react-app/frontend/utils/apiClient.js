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

function normalizeError(err) {
  // 呼叫端可能仍用 axios.isCancel(err) 判斷主動中斷的請求（見 _camera/label.jsx），
  // 這種情況原樣往外丟，不包成 ApiError。
  if (axios.isCancel(err)) throw err;
  const status = err.response?.status;
  const respData = err.response?.data;
  const message = respData?.detail || respData?.error || err.message || '請求失敗';
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
