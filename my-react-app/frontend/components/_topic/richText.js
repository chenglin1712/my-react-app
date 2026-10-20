/**
 * 專題文章的富文字文件（TipTap／ProseMirror JSON）工具。
 * 後端 article_doc.py 是最終的把關；這裡的檢查是第二道防線：就算資料庫裡有不合規的內容，
 * 前台也只渲染白名單內的節點，不安全的網址整個略過。
 */

// 選項型屬性的固定清單：編輯器的選單、前台渲染器、後端白名單（article_doc.py）三處一致。
// key 是存進文件的值，label 是給編輯者看的名稱；顏色的實際色碼在 rich-palette.css，文件裡永遠不存色碼或 CSS。
export const TEXT_COLORS = [
    { key: "red", label: "紅色" }, { key: "orange", label: "橘色" }, { key: "green", label: "綠色" },
    { key: "blue", label: "藍色" }, { key: "purple", label: "紫色" }, { key: "gray", label: "灰色" },
];
export const HIGHLIGHT_COLORS = [
    { key: "yellow", label: "黃色" }, { key: "green", label: "綠色" }, { key: "blue", label: "藍色" },
    { key: "pink", label: "粉紅色" }, { key: "gray", label: "灰色" },
];
export const FONT_SIZES = [
    { key: "sm", label: "小" }, { key: "", label: "一般" }, { key: "lg", label: "大" }, { key: "xl", label: "特大" },
];
export const TEXT_ALIGNS = [
    { key: "left", label: "靠左對齊" }, { key: "center", label: "置中對齊" },
    { key: "right", label: "靠右對齊" }, { key: "justify", label: "左右對齊" },
];
export const CALLOUT_TONES = [
    { key: "info", label: "資訊" }, { key: "success", label: "成功" },
    { key: "warning", label: "注意" }, { key: "danger", label: "警告" },
];
export const IMAGE_ALIGNS = [
    { key: "left", label: "靠左" }, { key: "center", label: "置中" }, { key: "right", label: "靠右" },
];
export const IMAGE_SIZES = [
    { key: "sm", label: "小" }, { key: "md", label: "中" }, { key: "lg", label: "大" }, { key: "full", label: "滿版" },
];

/** 值是不是某個固定清單裡的選項；不是就當作沒設定（前台渲染時不採用不認得的值） */
export const pick = (options, value) => (options.some((o) => o.key === value && o.key) ? value : null);

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);

/** 從 YouTube 網址取出 11 碼影片代號；不是 YouTube 的網址或格式不對回 null。只收 https，也接受使用者直接貼代號。 */
export function parseYoutubeId(value) {
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (YOUTUBE_ID.test(text)) return text;
    let url;
    try {
        url = new URL(text);
    } catch {
        return null;
    }
    if (url.protocol !== "https:" || url.username || url.password) return null;
    let id = null;
    if (url.hostname === "youtu.be") {
        id = url.pathname.slice(1).split("/")[0];
    } else if (YOUTUBE_HOSTS.has(url.hostname)) {
        const [first, second] = url.pathname.split("/").filter(Boolean);
        if (first === "watch") id = url.searchParams.get("v");
        else if (["embed", "shorts", "live", "v"].includes(first)) id = second;
    }
    return id && YOUTUBE_ID.test(id) ? id : null;
}

const IMAGE_HOST = "res.cloudinary.com";

// 只收「mailto:」加單一信箱，可帶一個 subject（預設主旨）；不收 cc／bcc／body 或多個收件人（與後端 article_doc._MAILTO 同一個意思）
const MAILTO = /^mailto:[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(\?subject=(?:[A-Za-z0-9._~!*'()-]|%[0-9A-Fa-f]{2})+)?$/;
const MAX_MAIL_SUBJECT_CHARS = 100;

function isSafeMailto(url) {
    if (url.length > 600 || !MAILTO.test(url)) return false;
    const at = url.indexOf("?subject=");
    if (at < 0) return true;
    try {
        const subject = decodeURIComponent(url.slice(at + 9));
        // eslint-disable-next-line no-control-regex
        return [...subject].length <= MAX_MAIL_SUBJECT_CHARS && !/[\u0000-\u001f\u007f-\u009f%&=\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/.test(subject);
    } catch {
        return false;
    }
}

/** 站內路徑（/ 開頭且不是 //）、https 網址或單純的 mailto 才是安全的連結；javascript:、data:、http: 一律不是 */
export function safeHref(value) {
    if (typeof value !== "string") return null;
    const url = value.trim();
    if (!url) return null;
    if (isSafeMailto(url)) return { href: url, external: false, mail: true };
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
        if (node.type === "youtube" && node.attrs?.videoId) found = true;
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
