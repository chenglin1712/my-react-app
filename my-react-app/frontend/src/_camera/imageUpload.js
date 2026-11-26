// 影像辨識上傳前的本機處理（稽核 FE3-11、FE3-12）：
// 1. 縮到長邊 MAX_EDGE 以內、轉成 JPEG（品質 QUALITY），手機 48MP 原圖不會因為超過 5 MB 被擋；
// 2. 畫進 canvas 再重新編碼，原檔的 EXIF（含 GPS 位置）不會被帶進新檔，等於上傳前就剝除；
// 3. 方向用 createImageBitmap 的 imageOrientation: 'from-image' 在解碼時套用，縮出來的圖不會橫倒。
// 解碼與編碼抽成可注入的函式：jsdom 沒有 canvas／createImageBitmap，測試傳假的 decode/encode 即可。

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.85;

export class ImageUploadError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "ImageUploadError";
        this.code = code; // "TOO_LARGE"（縮完仍超過上限）或 "UNREADABLE"（解不開或瀏覽器不支援）
    }
}

// 預設解碼：回傳 { width, height, draw(ctx, w, h), close() }
export async function decodeWithImageBitmap(file) {
    if (typeof createImageBitmap !== "function") throw new Error("createImageBitmap unavailable");
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        close: () => bitmap.close?.(),
    };
}

// 預設編碼：在 canvas 上重畫並輸出 JPEG Blob
export function encodeWithCanvas(decoded, width, height, quality) {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            reject(new Error("canvas 2d unavailable"));
            return;
        }
        // JPEG 沒有透明度：先鋪白底，透明 PNG 不會變成黑底
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, width, height);
        decoded.draw(ctx, width, height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))), "image/jpeg", quality);
    });
}

const toJpegName = (name = "photo") => `${name.replace(/\.[^./\\]+$/, "") || "photo"}.jpg`;

export async function prepareImageForUpload(file, options = {}) {
    const {
        decode = decodeWithImageBitmap,
        encode = encodeWithCanvas,
        maxEdge = MAX_EDGE,
        quality = JPEG_QUALITY,
        maxBytes = MAX_UPLOAD_BYTES,
    } = options;

    let decoded;
    try {
        decoded = await decode(file);
    } catch {
        // 解不開就不放行原檔：原檔可能帶 GPS 等中繼資料，隱私說明承諾「先在本機移除」
        throw new ImageUploadError("UNREADABLE", "無法處理這張圖片，請換一張再試。");
    }
    try {
        const scale = Math.min(1, maxEdge / Math.max(decoded.width, decoded.height));
        const width = Math.max(1, Math.round(decoded.width * scale));
        const height = Math.max(1, Math.round(decoded.height * scale));
        let blob;
        try {
            blob = await encode(decoded, width, height, quality);
        } catch {
            throw new ImageUploadError("UNREADABLE", "無法處理這張圖片，請換一張再試。");
        }
        if (blob.size > maxBytes) {
            throw new ImageUploadError("TOO_LARGE", "圖片不得超過 5 MB，請重新選擇。");
        }
        return new File([blob], toJpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
    } finally {
        decoded.close?.();
    }
}
