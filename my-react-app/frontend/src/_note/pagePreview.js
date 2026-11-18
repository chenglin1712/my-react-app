// 取出筆記內容的純文字預覽（頁面清單的卡片只顯示前幾行，CSS 截斷）。
// 不用 HTML parser（img/iframe 的 src 會被預先載入）：先砍掉 script/style 整段，再去標籤，最後只還原常見實體。
const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

export function previewText(html) {
  if (!html) return "";
  return String(html)
    .slice(0, 2000)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m])
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
