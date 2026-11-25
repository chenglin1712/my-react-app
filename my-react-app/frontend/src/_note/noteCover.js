// 分享筆記卡片的封面：取筆記第一張圖。傳入的必須是「已消毒」的預覽 HTML（圖片只剩 Cloudinary 與內嵌圖）。
// 只用正規表示式找 src，不用 HTML parser 去載入內容；找不到就回傳 null，由卡片畫預設封面。
const FIRST_IMG_SRC = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]+)"|'([^']+)')/i;

export function firstImageSrc(sanitizedHtml) {
  if (!sanitizedHtml) return null;
  const match = FIRST_IMG_SRC.exec(String(sanitizedHtml));
  return match ? (match[1] || match[2] || null) : null;
}

// 預覽文字區不再重複顯示圖片（圖片已經是封面）。
// 注意：要在「消毒之前」對原始 HTML 用，用完再送進消毒器；不要對消毒後的結果再改寫。
export function stripImages(sanitizedHtml) {
  return String(sanitizedHtml || "").replace(/<img\b[^>]*>/gi, "");
}

// 封面網址只收 Cloudinary 的 https 網址（和分享筆記消毒器的 strictImages 規則一致）。
const CLOUDINARY_URL = /^https:\/\/res\.cloudinary\.com\/[^\s"'<>]*$/i;
const FIRST_CLOUDINARY_IMG = /<img\b[^>]*?\ssrc\s*=\s*(?:"(https:\/\/res\.cloudinary\.com\/[^"\s<>']+)"|'(https:\/\/res\.cloudinary\.com\/[^'\s<>"]+)')/i;

export function isCloudinaryUrl(value) {
  return typeof value === "string" && CLOUDINARY_URL.test(value);
}

/**
 * 分享時要存進 sharedNotes.image 的封面：依序在「實際分享的頁面」裡找第一張 Cloudinary 圖片，
 * 找不到就回傳空字串。原本存的是這次開頁後最後上傳的圖，可能是沒有分享出去的那一頁的圖（FE6-08）。
 */
export function pickShareCover(pages) {
  for (const page of pages || []) {
    const match = FIRST_CLOUDINARY_IMG.exec(String(page?.content || ""));
    const src = match ? (match[1] || match[2]) : null;
    if (src) return src;
  }
  return "";
}
