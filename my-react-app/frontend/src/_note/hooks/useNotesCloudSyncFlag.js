import { useEffect, useState } from 'react';
import axios from 'axios';
import { apiGet } from '../../../utils/apiClient';

const FEATURES_URL = import.meta.env.VITE_API_FEATURES_URL || '/api/v1/features';

/**
 * 雲端筆記同步（notes_cloud_sync）是否開啟，由後台「功能開關」控制，後端用 GET /api/v1/features 回報。
 * 查不到、沒登入、伺服器出錯一律當成「關閉」：筆記維持原本只存在瀏覽器的行為，不會因為查詢失敗就開始往雲端寫。
 */
export function useNotesCloudSyncFlag(enabled) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setOn(false);
      return undefined;
    }
    const controller = new AbortController();
    apiGet(FEATURES_URL, { retries: 0, signal: controller.signal })
      .then((data) => setOn(data?.notesCloudSync === true))
      .catch((err) => {
        if (axios.isCancel(err) || controller.signal.aborted) return;
        setOn(false);
      });
    return () => controller.abort();
  }, [enabled]);

  return on;
}
