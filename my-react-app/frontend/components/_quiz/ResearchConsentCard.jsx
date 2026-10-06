import { useEffect, useState } from "react";
import { apiGet, apiPut } from "../../utils/apiClient";

// 同意說明文字的版本，必須跟後端 backend/config/quiz_research.py 的 CONSENT_VERSION 一致。
// 兩邊版本不同（後端改了記錄的內容、這裡的文字還沒更新）時整張卡片不顯示，
// 避免使用者「同意」了一段跟實際記錄內容不符的說明。
export const CONSENT_TEXT_VERSION = "2026-10-v2";

const CONSENT_URL = import.meta.env.VITE_API_RESEARCH_CONSENT_URL || "/api/v1/quiz/research_consent";

/**
 * 「協助改善詞綴練習」的選填同意。預設不記錄；只有按下同意才會開始記錄匿名資料，
 * 隨時可以撤回（撤回會刪除已記錄的資料）。功能沒開放、後端沒設定、讀取失敗時整張卡片不顯示，
 * 不打擾使用者，也不會在不確定的狀態下讓人按同意。
 */
export default function ResearchConsentCard() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiGet(CONSENT_URL)
      .then((data) => { if (!cancelled) setState(data); })
      .catch(() => { if (!cancelled) setState(null); });
    return () => { cancelled = true; };
  }, []);

  if (!state || !state.enabled || !state.available || state.version !== CONSENT_TEXT_VERSION) return null;

  const change = async (granted) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setState(await apiPut(CONSENT_URL, { granted }));
    } catch (err) {
      setError(err?.message || "目前無法更新，請稍後再試。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="result-consent" data-testid="research-consent">
      <h3 className="fw-bolder mb-2">協助改善詞綴練習（選填）</h3>
      <p className="mb-2">
        如果你同意，我們會在你作答句子填空題時記錄一筆資料：一組由你的帳號加上伺服器密鑰算出的代號（假名，
        不含你的帳號或 email；系統仍能用它在你要求撤回時找到並刪除你的資料）、這題考的詞綴規則、你選錯時選到的
        詞綴規則、錯誤的類型、答題用時的粗略分級（例如「3–6 秒」）、時間（只到小時），以及系統在你作答前預測你
        答對的機率（兩種模型各一個）、作答前後你在這條詞綴上的熟練度估計。
      </p>
      <p className="mb-2">
        不會記錄你的姓名、email，也不會記錄題目的詞或句子。資料只用來改善出題，以及評估「依詞綴熟練度」的預測準不準。
        你可以隨時撤回，撤回後已記錄的資料會一併刪除。不同意完全不影響你使用任何功能。
      </p>
      <p className="fw-bold mb-2" role="status">
        目前狀態：{state.granted ? "已同意" : "未同意"}
      </p>
      {state.granted ? (
        <button type="button" className="retry-btn" disabled={busy} onClick={() => change(false)}>
          撤回同意並刪除已記錄的資料
        </button>
      ) : (
        <button type="button" className="retry-btn" disabled={busy} onClick={() => change(true)}>
          我同意
        </button>
      )}
      {error && <p className="result-model-warning" role="alert">{error}</p>}
    </div>
  );
}
