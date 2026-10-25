import { useEffect, useState } from "react";
import { apiGet } from "../utils/apiClient";

/**
 * 各族語的翻譯/語料能力（例句數、詞條數、有沒有整句真人原音）。原本只有
 * _translate/index.jsx 自己讀一次，這裡抽出來讓 _search/index.jsx 也能用同一份
 * 資料判斷要不要顯示句子的 TTS 備用播放鈕（原本是寫死「布農語／排灣語」）。
 * guest：翻譯頁開放訪客試用後，翻譯 router 對沒登入的請求要求後端核發的 X-Guest-Token，所以翻譯頁傳 true
 * （已登入時 apiClient 只帶 Authorization，不會送訪客憑證）。enabled 為 false 時先不查（登入狀態還在確認），
 * refreshKey 變動（登入、登出）時重查。
 *
 * 這份資訊只是輔助顯示用，拿不到不影響主要功能，所以失敗時只是保持
 * capabilities 為 null，不對外拋出錯誤。
 */
export function useTranslateCapabilities({ guest = false, enabled = true, refreshKey } = {}) {
    const [capabilities, setCapabilities] = useState(null);

    useEffect(() => {
        if (!enabled) return undefined;
        let active = true;
        (async () => {
            try {
                const data = await apiGet(import.meta.env.VITE_API_TRANSLATE_CAPABILITIES_URL, { guest });
                if (active) setCapabilities(data.tribes ?? []);
            } catch {
                // 能力資訊只是輔助顯示，拿不到不影響主要功能。
            }
        })();
        return () => { active = false; };
    }, [guest, enabled, refreshKey]);

    return capabilities;
}
