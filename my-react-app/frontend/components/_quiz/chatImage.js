// AI 助手的圖片提問（路線圖 #24）：把學生拍的照片縮小、轉成 JPEG 與 base64 再送出。
// 圖片只用於這一次提問：後端不保存，這裡也只在記憶體裡持有，用完就釋放預覽網址。

// 後端規格（backend/AIModel/image_input.py）：解碼後 1,000,000 位元組以內、邊長 16 到 8000 像素
export const MAX_SIDE = 1568;                    // Claude 建議的長邊上限；再大只會變慢、變貴，辨識不會更好
export const MAX_ENCODED_BYTES = 900_000;        // 留一點餘裕給 base64 與後端上限
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024; // 原檔太大（例如未壓縮的相機檔）就不嘗試解碼，避免卡住手機
export const DEFAULT_IMAGE_PROMPT = '請辨識圖中的族語文字並說明';

export const MIN_SIDE = 16;                       // 後端的最小邊長，短邊低於這個一定會被拒絕
export const MAX_SOURCE_PIXELS = 100_000_000;     // 解碼後超過（約 1 億像素）就不處理，避免畫布吃光記憶體

const QUALITY_STEPS = [0.82, 0.7, 0.58, 0.46];
const SHRINK_STEPS = [1, 0.75, 0.55];
const SUPPORTED = /^image\/(jpeg|png|webp|heic|heif)$/;

export const IMAGE_ERROR_TEXT = {
    unsupported: '這個檔案不是可以使用的圖片，請選擇照片（JPEG、PNG 或 WebP）。',
    source_too_large: '這張圖片太大了，請拍近一點或換一張。',
    decode_failed: '讀不出這張圖片，請重新拍照或換一張。',
    too_large: '這張圖片壓縮後還是太大，請拍近一點或換一張。',
    bad_size: '這張圖片的長寬比例太極端或太小，請重新拍照。',
};

export class ChatImageError extends Error {
    constructor(code) {
        super(IMAGE_ERROR_TEXT[code] ?? IMAGE_ERROR_TEXT.decode_failed);
        this.code = code;
    }
}

/** 等比例縮到長邊不超過 maxSide；已經夠小就維持原尺寸（不放大）。 */
export function fitWithin(width, height, maxSide = MAX_SIDE) {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** 縮放後的輸出尺寸；短邊低於後端下限（MIN_SIDE）就丟 bad_size，不要產生一張後端必然拒絕的圖。 */
export function outputSize(width, height, shrink = 1) {
    const base = fitWithin(width, height);
    const out = { width: Math.max(1, Math.round(base.width * shrink)), height: Math.max(1, Math.round(base.height * shrink)) };
    if (Math.min(out.width, out.height) < MIN_SIDE) throw new ChatImageError('bad_size');
    return out;
}

async function decode(file) {
    // imageOrientation: 'from-image' 讓手機直拍的照片轉成正的，不然辨識到的是側躺的字
    if (typeof createImageBitmap === 'function') {
        try {
            return await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch {
            // 少數瀏覽器不支援選項或格式，退回 <img>
        }
    }
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
    } finally {
        URL.revokeObjectURL(url);
    }
}

const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

/**
 * 把使用者選的檔案變成可以送給後端的圖片：{ media_type, data, previewUrl }。
 * previewUrl 是縮圖後的 object URL，呼叫端用完要 URL.revokeObjectURL。
 * 失敗時丟 ChatImageError（code 對應 IMAGE_ERROR_TEXT）。
 */
export async function prepareChatImage(file) {
    if (!file || !SUPPORTED.test(file.type)) throw new ChatImageError('unsupported');
    if (file.size > MAX_SOURCE_BYTES) throw new ChatImageError('source_too_large');

    let bitmap;
    try {
        bitmap = await decode(file);
    } catch {
        throw new ChatImageError('decode_failed');
    }

    try {
        if (bitmap.width * bitmap.height > MAX_SOURCE_PIXELS) throw new ChatImageError('source_too_large');
        for (const shrink of SHRINK_STEPS) {
            let size;
            try {
                size = outputSize(bitmap.width, bitmap.height, shrink);
            } catch (error) {
                // 第一輪就太小代表原圖本身不合格；縮到更小才不合格，代表已經壓不進大小上限
                throw shrink === 1 ? error : new ChatImageError('too_large');
            }
            const { width, height } = size;
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) throw new ChatImageError('decode_failed');
            context.fillStyle = 'white';               // 透明的 PNG 轉成 JPEG 會變黑底，先鋪白底
            context.fillRect(0, 0, width, height);
            context.drawImage(bitmap, 0, 0, width, height);

            for (const quality of QUALITY_STEPS) {
                const blob = await toBlob(canvas, quality);
                if (!blob) throw new ChatImageError('decode_failed');
                if (blob.size <= MAX_ENCODED_BYTES) {
                    return {
                        media_type: 'image/jpeg',
                        data: await blobToBase64(blob),
                        previewUrl: URL.createObjectURL(blob),
                    };
                }
            }
        }
        throw new ChatImageError('too_large');
    } finally {
        bitmap.close?.();
    }
}
