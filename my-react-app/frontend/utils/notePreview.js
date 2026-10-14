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

/**
 * Firestore 單一文件上限是 1 MiB（1,048,576 位元組）。分享會把所有選取的頁面整包寫進同一份
 * sharedNotes 文件的 pages 欄位，50 頁 x 每頁 100 KB 就會超過。這裡抓約 900 KB 當上限，
 * 預留欄位名稱、preview、封面網址、按讚名單等其他欄位的空間。
 */
export const SHARE_MAX_PAYLOAD_BYTES = 900 * 1024;

const textEncoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

function utf8Length(text) {
  if (textEncoder) return textEncoder.encode(text).length;
  return text.length * 3; // 沒有 TextEncoder 時偏保守估計（中文每字 3 位元組）
}

/**
 * 估算分享時實際會寫進 Firestore 的大小（位元組）。傳入的 pages 必須是「已經消毒、準備寫入」
 * 的版本，因為大小要以真正寫出去的內容為準。用 JSON 字串長度當估計，JSON 的跳脫字元與標點
 * 會讓結果略高於 Firestore 的計法，方向偏保守。但這仍是估計、不是嚴格上界：Firestore 對字串、
 * 欄位名稱、時間戳記另有編碼成本，所以另外留 SHARE_PAYLOAD_OVERHEAD_BYTES 的緩衝，上限也
 * 比 1 MiB 低約 124 KB。真正寫入失敗時，呼叫端仍要保留泛用的錯誤處理。
 * @param extra 文件裡 pages、preview 以外的欄位（image、uid、username、avatarUrl…）
 * @returns {{ total: number, perPage: number[] }}
 */
export const SHARE_PAYLOAD_OVERHEAD_BYTES = 4 * 1024;

export function estimateSharePayload(pages, preview = "", extra = {}) {
  const perPage = pages.map((page) => utf8Length(JSON.stringify(page)));
  const total = perPage.reduce((sum, bytes) => sum + bytes, 0)
    + utf8Length(preview) + utf8Length(JSON.stringify(extra)) + SHARE_PAYLOAD_OVERHEAD_BYTES;
  return { total, perPage };
}

export const formatKb = (bytes) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function buildPreview(html) {
  const withoutImages = (html || "").replace(/<img\b[^>]*>/gi, "");
  const truncated =
    withoutImages.length > PREVIEW_SOURCE_TRUNCATION_LENGTH
      ? withoutImages.slice(0, PREVIEW_SOURCE_TRUNCATION_LENGTH)
      : withoutImages;
  return DOMPurify.sanitize(truncated || "<p></p>");
}
