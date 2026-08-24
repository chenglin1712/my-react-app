import { useEffect, useState } from "react";
import { apiGet } from "../utils/apiClient";

/**
 * 各族語的翻譯/語料能力（例句數、詞條數、有沒有整句真人原音）。原本只有
 * _translate/index.jsx 自己讀一次，這裡抽出來讓 _search/index.jsx 也能用同一份
 * 資料判斷要不要顯示句子的 TTS 備用播放鈕（原本是寫死「布農語／排灣語」）。
 *
 * 這份資訊只是輔助顯示用，拿不到不影響主要功能，所以失敗時只是保持
 * capabilities 為 null，不對外拋出錯誤。
 */
export function useTranslateCapabilities() {
    const [capabilities, setCapabilities] = useState(null);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const data = await apiGet(import.meta.env.VITE_API_TRANSLATE_CAPABILITIES_URL);
                if (active) setCapabilities(data.tribes ?? []);
            } catch {
                // 能力資訊只是輔助顯示，拿不到不影響主要功能。
            }
        })();
        return () => { active = false; };
    }, []);

    return capabilities;
}
