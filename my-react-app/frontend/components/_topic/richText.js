/**
 * 專題文章的富文字文件（TipTap／ProseMirror JSON）工具。
 * 後端 article_doc.py 是最終的把關；這裡的檢查是第二道防線：就算資料庫裡有不合規的內容，
 * 前台也只渲染白名單內的節點，不安全的網址整個略過。
 */

const IMAGE_HOST = "res.cloudinary.com";

/** 站內路徑（/ 開頭且不是 //）或 https 網址才是安全的連結；javascript:、data:、http: 一律不是 */
export function safeHref(value) {
    if (typeof value !== "string") return null;
    const url = value.trim();
    if (!url) return null;
    if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")) return { href: url, external: false };
    try {
        const parsed = new URL(url);
        if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return { href: url, external: true };
    } catch {
        // 不是合法網址就當作沒有連結
    }
    return null;
}

/** 圖片只收 Cloudinary 的 https 網址，與後端 validate_cloudinary_image_url 同一個意思 */
export function safeImageSrc(value) {
    if (typeof value !== "string") return null;
    try {
        const parsed = new URL(value.trim());
        if (parsed.protocol === "https:" && parsed.hostname === IMAGE_HOST && !parsed.username && !parsed.password) return parsed.href;
    } catch {
        // 不是合法網址就當作沒有圖
    }
    return null;
}

const isDoc = (doc) => Boolean(doc) && typeof doc === "object" && !Array.isArray(doc) && doc.type === "doc";

function walk(node, visit) {
    if (!node || typeof node !== "object") return;
    visit(node);
    if (Array.isArray(node.content)) node.content.forEach((child) => walk(child, visit));
}

/** 文件裡的可讀文字字數（不含空白以外的樣式），給字數提示用 */
export function countDocText(doc) {
    if (!isDoc(doc)) return 0;
    let total = 0;
    walk(doc, (node) => {
        if (node.type === "text" && typeof node.text === "string") total += node.text.length;
    });
    return total;
}

/** 有沒有可讀內容：至少一個非空白文字，或一張圖 */
export function hasDocContent(doc) {
    if (!isDoc(doc)) return false;
    let found = false;
    walk(doc, (node) => {
        if (node.type === "image" && node.attrs?.src) found = true;
        if (node.type === "text" && typeof node.text === "string" && node.text.trim()) found = true;
    });
    return found;
}

/** "2026-10-19" → "2026 年 10 月 19 日"；格式不對就回空字串（不顯示日期，也不顯示 Invalid Date） */
export function formatArticleDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof value === "string" ? value : "");
    if (!match) return "";
    return `${match[1]} 年 ${Number(match[2])} 月 ${Number(match[3])} 日`;
}
