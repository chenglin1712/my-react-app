import { useCallback, useEffect, useRef, useState } from 'react';

import { uploadToCloudinary } from '@utils/uploadToCloudinary';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * 後台「選檔案 → （可選）本地預覽 → 上傳到 Cloudinary → 換成正式網址」
 * 這個生命週期，在 AnnouncementEditor.jsx／HomepageConfig.jsx／
 * QuizChoice.jsx／QuizTrueFalse.jsx 各自重寫了一次，且都有同樣幾個問題：
 *
 *   1. 有本地預覽的兩個檔案（Announcement／Homepage）：`URL.createObjectURL()`
 *      建立的本地預覽網址從未 revoke，換圖／切換編輯目標／unmount 都沒有
 *      清理。
 *   2. 沒有 generation token：快速換選兩個檔案時，較舊的上傳結果可能在
 *      較新的上傳完成之後才回來，把新選的檔案覆蓋掉。
 *   3. 沒有 identity/generation 隔離：關閉目前的編輯目標、換到另一筆記錄
 *      編輯，前一筆還在飛的上傳完成時，回呼仍然會被呼叫，把網址寫進
 *      「現在正在編輯的另一筆」表單裡。
 *
 * 這個 hook 只接手上傳本身的生命週期，不管欄位長什麼樣、UI 怎麼呈現——
 * 呼叫端傳入 onUploaded(secureUrl)，自己決定要把網址寫進表單的哪個欄位。
 * key 讓同一個 hook instance 可以同時管理多個獨立的上傳欄位（例如中級
 * 選擇題的三張選項圖片），跟既有慣例「同一時間只有一個欄位在上傳」一致
 * ——不是要引進允許多欄位並行上傳的新行為。
 *
 * resetKey 改變時（例如切換到另一筆編輯目標）視同重置：任何還在飛的
 * 上傳結果都會被視為過期、不會再呼叫 onUploaded，本地預覽物件網址也會
 * 一併 revoke。
 */
export function useMediaUpload({ resetKey, maxFileSize = MAX_FILE_SIZE } = {}) {
    const [uploadingKey, setUploadingKey] = useState(null);
    const [error, setError] = useState('');
    const [previews, setPreviews] = useState({});

    const generationRef = useRef(0);
    const mountedRef = useRef(true);
    const objectUrlsRef = useRef({});

    const revoke = (key) => {
        const url = objectUrlsRef.current[key];
        if (url) {
            URL.revokeObjectURL(url);
            delete objectUrlsRef.current[key];
        }
    };

    const revokeAll = () => {
        Object.keys(objectUrlsRef.current).forEach(revoke);
    };

    useEffect(() => () => {
        mountedRef.current = false;
        revokeAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        generationRef.current += 1;
        revokeAll();
        setUploadingKey(null);
        setError('');
        setPreviews({});
        // resetKey 是呼叫端傳入的「目前編輯目標」識別值，識別值本身改變
        // 就代表要重置，不需要（也不應該）把它以外的東西列進相依陣列。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetKey]);

    /** 直接設定某個 key 的預覽網址（例如載入既有資料時帶入目前的正式圖片
     * 網址），不經過上傳流程。 */
    const setPreview = useCallback((key, url) => {
        revoke(key);
        setPreviews((current) => ({ ...current, [key]: url ?? '' }));
    }, []);

    const upload = useCallback(async (file, key, {
        onUploaded, resourceType, localPreview = false,
    } = {}) => {
        if (!file) return;

        if (file.size > maxFileSize) {
            setError(`檔案不得超過 ${Math.round(maxFileSize / (1024 * 1024))} MB，請重新選擇。`);
            return;
        }

        const generation = ++generationRef.current;
        setError('');
        setUploadingKey(key);

        if (localPreview) {
            revoke(key);
            const objectUrl = URL.createObjectURL(file);
            objectUrlsRef.current[key] = objectUrl;
            setPreviews((current) => ({ ...current, [key]: objectUrl }));
        }

        try {
            const secureUrl = await uploadToCloudinary(
                file,
                resourceType ? { resourceType } : undefined,
            );
            if (generation !== generationRef.current || !mountedRef.current) return;

            revoke(key);
            setPreviews((current) => ({ ...current, [key]: secureUrl }));
            onUploaded?.(secureUrl);
        } catch (err) {
            if (generation !== generationRef.current || !mountedRef.current) return;

            console.error('檔案上傳失敗', err);
            setError('上傳失敗，請重新選擇檔案。');
        } finally {
            if (generation === generationRef.current && mountedRef.current) {
                setUploadingKey(null);
            }
        }
    }, [maxFileSize]);

    return {
        uploadingKey,
        isUploading: (key) => uploadingKey === key,
        error,
        setError,
        previews,
        setPreview,
        upload,
    };
}

export default useMediaUpload;
