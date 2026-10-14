/**
 * 舊版筆記把圖片以 Base64 直接塞在內容裡（<img src="data:image/...">），一張圖就可能讓單頁超過
 * 100 KB 的雲端上限。D-3 在把筆記寫上雲端前，把這些內嵌圖片逐一傳到 Cloudinary，換成真正的網址。
 *
 * 只處理 base64 編碼的 data:image/*；其他寫法（例如 SVG 的百分比編碼）原樣保留，
 * 之後如果內容仍然太大，大小檢查會把那一頁標成失敗，由使用者處理。
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 和編輯器插入圖片時的上限一致

export class ImageConvertError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'ImageConvertError';
    this.code = code;
  }
}

// 只處理 <img> 標籤的 src（和 hasDataImages 判斷一致），不會動到其他標籤的屬性。
const DATA_IMAGE_SRC = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(data:image\/[a-z0-9.+-]+;base64,[^"']*)\2/gi;

export function dataUrlToBlob(dataUrl) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(dataUrl);
  if (!match) throw new ImageConvertError('decode', '圖片資料格式不正確');
  // 先用字串長度估算大小，太大就不解碼（完整 atob 一張超大圖會造成記憶體尖峰、讓頁面卡住）。
  if ((match[2].length * 3) / 4 > MAX_IMAGE_BYTES + 3) {
    throw new ImageConvertError('too_big', '有一張圖片超過 5 MB，無法轉換。');
  }
  let binary;
  try {
    binary = atob(match[2].replace(/\s+/g, ''));
  } catch (err) {
    throw new ImageConvertError('decode', '圖片資料無法解碼', { cause: err });
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1] });
}

/**
 * @param {string} html
 * @param {{ upload: (blob: Blob) => Promise<string>, cache?: Map<string,string> }} deps
 *   upload 傳回圖片網址；cache 讓同一張圖（同一份 data URL）在多頁或重試時只上傳一次。
 * @returns {Promise<{ content: string, converted: number }>}
 * 任何一張失敗就整頁丟出 ImageConvertError，呼叫端不會拿到只轉換一半的內容。
 */
export async function convertDataImages(html, { upload, cache = new Map() }) {
  const sources = new Set();
  for (const match of html.matchAll(DATA_IMAGE_SRC)) sources.add(match[3]);
  if (sources.size === 0) return { content: html, converted: 0 };

  const urlBySource = new Map();
  for (const source of sources) {
    if (cache.has(source)) {
      urlBySource.set(source, cache.get(source));
      continue;
    }
    const blob = dataUrlToBlob(source);
    if (blob.size > MAX_IMAGE_BYTES) {
      throw new ImageConvertError('too_big', '有一張圖片超過 5 MB，無法轉換。');
    }
    let url;
    try {
      url = await upload(blob);
    } catch (err) {
      throw new ImageConvertError('upload', '圖片上傳失敗', { cause: err });
    }
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) {
      throw new ImageConvertError('upload', '圖片上傳後沒有取得有效的網址');
    }
    cache.set(source, url);
    urlBySource.set(source, url);
  }

  const content = html.replace(DATA_IMAGE_SRC, (whole, prefix, quote, source) => `${prefix}${quote}${urlBySource.get(source)}${quote}`);
  return { content, converted: sources.size };
}
