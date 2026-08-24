import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadToCloudinary } from '@utils/uploadToCloudinary';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * 頭像檔案選取＋上傳的共用狀態機：檔案大小驗證、本地預覽（object URL 的
 * 生命週期自己管理——選新檔或卸載時會 revoke 掉前一張，不會累積洩漏）、
 * 上傳中狀態、上傳錯誤訊息，以及使用者快速連續換圖時「只有最後一次選取
 * 的結果會生效」的防呆（generation token，跟 useAudioPlayback 同一套作法）。
 *
 * 原本 editProfile.jsx／registerForm.jsx 各自維護一份幾乎相同的邏輯，這裡
 * 抽出共用部分；表單本身的錯誤訊息顯示方式、上傳完的網址要寫進哪個欄位，
 * 因頁面而異，交給呼叫端處理 selectFile() 回傳的網址。
 *
 * @param {object} [options]
 * @param {string|null} [options.initialPreviewUrl] 初始預覽圖網址（例如既有頭像）。
 * @param {object} [options.uploadOptions] 直接轉傳給 uploadToCloudinary 的選項
 *   （例如 { transform: false }）。
 * @returns {{ previewUrl: string|null, isUploading: boolean, uploadError: string,
 *   selectFile: (file: File) => Promise<string|null> }} selectFile 上傳成功時
 *   resolve 為 secure_url；驗證失敗、上傳失敗、或已被更新一次選取取代時 resolve 為 null。
 */
export function useAvatarUpload({ initialPreviewUrl = null, uploadOptions } = {}) {
  const [previewUrl, setPreviewUrl] = useState(initialPreviewUrl);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const objectUrlRef = useRef(null);
  const generationRef = useRef(0);

  const revokePreview = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => revokePreview, [revokePreview]);

  const selectFile = useCallback(async (file) => {
    if (!file) return null;

    if (file.size > MAX_AVATAR_BYTES) {
      setUploadError('圖片不得超過 5 MB，請重新選擇。');
      return null;
    }
    setUploadError('');

    // 世代編號：選取新檔即讓上一次還在進行中的上傳失效，避免較早選的圖片
    // 較晚上傳完成時覆蓋掉使用者後來選的結果。
    const myGeneration = (generationRef.current += 1);
    const isCurrent = () => generationRef.current === myGeneration;

    revokePreview();
    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;
    setPreviewUrl(objectUrl);
    setIsUploading(true);

    try {
      const secureUrl = await uploadToCloudinary(file, uploadOptions);
      return isCurrent() ? secureUrl : null;
    } catch (err) {
      if (isCurrent()) {
        console.error('圖片上傳失敗', err);
        setUploadError('圖片上傳失敗');
      }
      return null;
    } finally {
      if (isCurrent()) setIsUploading(false);
    }
  }, [revokePreview, uploadOptions]);

  return { previewUrl, isUploading, uploadError, selectFile };
}

export default useAvatarUpload;
