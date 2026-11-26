import { useEffect, useState } from 'react';
import axios from 'axios';
import { apiGet } from '../../../utils/apiClient';
import { apiUrl } from "../../../utils/apiUrls";

const FEATURES_URL = apiUrl('FEATURES');

// 查詢失敗後的自動重試間隔（毫秒）。用完仍失敗就停下來，改等 online 事件或使用者重新整理，
// 不無限輪詢後端。
const RETRY_DELAYS_MS = [5000, 15000, 45000];

/**
 * 雲端筆記同步（notes_cloud_sync）是否開啟，由後台「功能開關」控制，後端用 GET /api/v1/features 回報。
 *
 * 稽核 FE6-18：原本查詢失敗就直接當成「關閉」且不再查，離線開啟筆記頁整個工作階段都不會同步。
 * 現在分三種狀態：
 *   - on=true            後端確認開啟。
 *   - on=false, unknown=false  後端確認關閉（或沒登入）。
 *   - on=false, unknown=true   還沒查到（查詢中或失敗）。失敗時不往雲端寫（維持保守），
 *                              但會在瀏覽器回到 online、或幾次退避後重查，查到才切換。
 * 呼叫端用 unknown 避免在「其實只是沒查到」時，誤導使用者說筆記只存在這台裝置。
 */
export function useNotesCloudSyncFlagStatus(enabled) {
  const [result, setResult] = useState({ on: false, resolved: false });

  useEffect(() => {
    setResult({ on: false, resolved: false });
    if (!enabled) return undefined;
    let resolved = false;
    let attempt = 0;
    let timer = null;
    let controller = null;
    // 查詢函式放在 effect 內：失敗時要排程再呼叫自己，且生命週期跟這次 effect 綁在一起
    function check() {
      controller?.abort();
      const mine = new AbortController();
      controller = mine;
      apiGet(FEATURES_URL, { retries: 0, signal: mine.signal })
        .then((data) => {
          if (mine.signal.aborted) return;
          resolved = true;
          setResult({ on: data?.notesCloudSync === true, resolved: true });
        })
        .catch((err) => {
          if (axios.isCancel(err) || mine.signal.aborted) return;
          // 保留「未知」：不當成關閉，排下一次退避重試
          const delay = RETRY_DELAYS_MS[attempt];
          attempt += 1;
          if (delay !== undefined) timer = setTimeout(check, delay);
        });
    }
    const onOnline = () => {
      if (resolved) return;
      clearTimeout(timer);
      attempt = 0;
      check();
    };
    check();
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
      clearTimeout(timer);
      controller?.abort();
    };
  }, [enabled]);

  return { on: result.on, unknown: enabled && !result.resolved };
}

/** 只要布林結果的簡化版（相容原本的呼叫方式）。 */
export function useNotesCloudSyncFlag(enabled) {
  return useNotesCloudSyncFlagStatus(enabled).on;
}
