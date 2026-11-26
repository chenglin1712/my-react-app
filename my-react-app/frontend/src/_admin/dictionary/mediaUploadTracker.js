import {
    createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';

/**
 * 稽核 FE7a-08：詞條表單裡的音檔／圖片欄位散在好幾層子元件（詞條音檔、解釋圖片、例句音檔），
 * 上傳中按「儲存草稿」會存進少了那個檔案的內容。用 context 讓每個 MediaUploadField
 * 回報自己是否在上傳，編輯器只要看總數，不必一層層傳 callback。
 */
export const MediaUploadTrackerContext = createContext(null);

/** 編輯器端：回傳 { uploadingCount, tracker }，tracker 交給 MediaUploadTrackerContext.Provider。 */
export function useMediaUploadCounter() {
    const [uploadingCount, setUploadingCount] = useState(0);
    const change = useCallback((delta) => {
        setUploadingCount((count) => Math.max(0, count + delta));
    }, []);
    const tracker = useMemo(() => ({ change }), [change]);
    return { uploadingCount, tracker };
}

/**
 * 欄位端：uploading 為 true 的期間計數 +1；上傳結束或欄位在上傳中被移除（卸載）時 -1，
 * 不會因為使用者上傳中刪掉那一列而讓計數卡住。
 */
export function useReportUploading(uploading, onUploadingChange) {
    const tracker = useContext(MediaUploadTrackerContext);
    useEffect(() => {
        if (!uploading) return undefined;
        tracker?.change(1);
        onUploadingChange?.(true);
        return () => {
            tracker?.change(-1);
            onUploadingChange?.(false);
        };
        // onUploadingChange 只是通知，identity 變動不需要重新計數
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uploading, tracker]);
}
