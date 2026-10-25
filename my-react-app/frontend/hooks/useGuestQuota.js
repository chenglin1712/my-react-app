import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { apiGet } from '../utils/apiClient';

// 沒設定環境變數時，從翻譯網址推出額度查詢網址（同一個 router 底下的 /guest-quota）。
const TRANSLATE_URL = import.meta.env.VITE_API_TRANSLATE_URL || '/api/v1/translation/translate';
const QUOTA_URL = import.meta.env.VITE_API_TRANSLATE_GUEST_QUOTA_URL
  || TRANSLATE_URL.replace(/\/translate\/?$/, '/guest-quota');

const IDLE = { status: 'idle', limit: null, remaining: null, deniedReason: null };

/**
 * 後端用 429 + code 說明「為什麼今天不能再試用」。沿用既有的兩種提示，不新增畫面：
 * - guest_quota_exhausted：這個瀏覽器今天用完（browser）
 * - guest_global_capped：全站今天的訪客名額用完，對使用者的意義同上，顯示「今天的免費試用次數用完了」（browser）
 * - guest_ip_capped、guest_issue_capped（這個網路今天領太多張憑證）：這個網路今天用完（ip）
 * 不是這幾種就回傳 null。
 */
const DENIED_REASONS = {
  guest_quota_exhausted: 'browser',
  guest_global_capped: 'browser',
  guest_ip_capped: 'ip',
  guest_issue_capped: 'ip',
};
const deniedReasonOf = (err) => (err?.status === 429 ? DENIED_REASONS[err?.data?.code] ?? null : null);

/**
 * 訪客翻譯試用的額度狀態（C-3）。只有「沒登入的訪客」才需要啟用。
 *
 * status：
 * - idle：不需要額度（已登入，或還沒判斷出是不是訪客）
 * - loading：正在向後端查詢今天剩幾次
 * - ready：已知 limit 與 remaining；remaining 為 0 或 deniedReason 有值就是「用完了」
 * - closed：後端沒有開放訪客試用（旗標關閉或伺服器未設定），回 401，或核發訪客憑證時回 503 guest_unavailable；頁面應改成「請先登入」
 * - unknown：查不到剩餘次數（網路或伺服器暫時有問題），仍允許嘗試翻譯，由後端把關
 *
 * deniedReason：browser（這個瀏覽器今天用完）、ip（這個網路今天用完）。
 */
export function useGuestQuota(enabled) {
  const [state, setState] = useState(IDLE);

  useEffect(() => {
    if (!enabled) {
      setState(IDLE);
      return undefined;
    }
    const controller = new AbortController();
    setState({ ...IDLE, status: 'loading' });
    apiGet(QUOTA_URL, { guest: true, retries: 0, signal: controller.signal })
      .then((data) => {
        if (!data?.isGuest) {
          setState(IDLE);
          return;
        }
        setState({ status: 'ready', limit: data.limit, remaining: data.remaining, deniedReason: null });
      })
      .catch((err) => {
        if (axios.isCancel(err) || controller.signal.aborted) return;
        // 領取訪客憑證就被擋（這個網路今天領太多）：一開始就顯示「用完了」，不用等使用者按翻譯才知道
        const denied = deniedReasonOf(err);
        if (denied) {
          setState({ status: 'ready', limit: err.data.limit ?? null, remaining: 0, deniedReason: denied });
          return;
        }
        // 401 與 503（guest_unavailable）都代表訪客試用沒有開放，頁面改成請先登入
        setState({ ...IDLE, status: err?.status === 401 || err?.data?.code === 'guest_unavailable' ? 'closed' : 'unknown' });
      });
    return () => controller.abort();
  }, [enabled]);

  /** 翻譯成功回應裡的 guestQuota：{ limit, remaining, resetsAt } */
  const applyResponse = useCallback((guestQuota) => {
    if (!guestQuota || typeof guestQuota.remaining !== 'number') return;
    setState({ status: 'ready', limit: guestQuota.limit, remaining: guestQuota.remaining, deniedReason: null });
  }, []);

  /** 翻譯被擋下（429 / 401）時，依後端的 code 更新狀態。回傳 true 表示這個錯誤已由額度提示處理，
   * 呼叫端不需要再顯示一般錯誤訊息。 */
  const applyError = useCallback((err) => {
    if (err?.status === 401) {
      setState({ ...IDLE, status: 'closed' });
      return true;
    }
    const denied = deniedReasonOf(err);
    if (denied) {
      setState((prev) => ({
        status: 'ready',
        limit: err.data.limit ?? prev.limit,
        remaining: 0,
        deniedReason: denied,
      }));
      return true;
    }
    return false;
  }, []);

  const exhausted = state.status === 'ready' && (state.remaining === 0 || state.deniedReason !== null);

  return { ...state, exhausted, applyResponse, applyError };
}
