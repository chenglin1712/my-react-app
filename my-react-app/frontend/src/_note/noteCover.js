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
