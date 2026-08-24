import DOMPurify from "dompurify";

/**
 * Firestore 的 sharedNotes 建立規則要求 preview.size() <= 5000（字元數）。原本
 * preview 直接塞整頁未截斷的 HTML，編輯器「上傳圖片」又是把圖片轉成 base64
 * 直接內嵌進內容，一張小圖片轉出來的 <img src="data:..."> 就輕鬆超過 5000 字元，
 * 導致只要分享的筆記裡有圖片，Firestore 一定會拒絕寫入，而前端只顯示「分享失敗，
 * 請稍後再試」，看不出真正原因。preview 只是列表頁的摘要，不需要保留內嵌圖片
 * （封面圖已經有獨立的 image 欄位），這裡先濾掉 <img>，再截斷到遠低於規則上限
 * 的長度，最後用 DOMPurify 重新過一次——就算截斷把某個標籤切到一半，也會在這裡
 * 被修好或濾掉，不會產生殘缺的 HTML。
 */
// 注意：這是 sanitize 前、原始 HTML 的截斷預算，不是最終輸出字元數的保證——
// DOMPurify 修掉殘缺標籤後，實際長度可能比這個數字略短。
export const PREVIEW_SOURCE_TRUNCATION_LENGTH = 2000;
export const SHARE_MAX_PAGES = 50;

export function buildPreview(html) {
  const withoutImages = (html || "").replace(/<img\b[^>]*>/gi, "");
  const truncated =
    withoutImages.length > PREVIEW_SOURCE_TRUNCATION_LENGTH
      ? withoutImages.slice(0, PREVIEW_SOURCE_TRUNCATION_LENGTH)
      : withoutImages;
  return DOMPurify.sanitize(truncated || "<p></p>");
}
