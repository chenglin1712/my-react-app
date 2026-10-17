import { isExternalUrl } from "../ui/externalUrl";

const MAX_TOPICS = 3;

const cleanText = (value) => (typeof value === "string" ? value.trim() : "");

// 專題圖片走 Cloudinary（後端只收 res.cloudinary.com），也容許自己網域的相對路徑；
// 其他協定（javascript:、data:）與協定相對網址一律當作沒有圖，卡片改成純文字。
const safeImageUrl = (value) => {
    const url = cleanText(value);
    if (/^https:\/\//i.test(url)) return url;
    if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")) return url;
    return null;
};

// 站內路由用 react-router 的 Link，http(s) 網址另開新視窗，其餘（空字串、javascript: 等）不是連結
const classifyLink = (value) => {
    const url = cleanText(value);
    if (isExternalUrl(url)) return { href: url, external: true };
    if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")) return { href: url, external: false };
    return null;
};

/**
 * 公開端點 /adminapi/public/featured-topics/ 的回應 → 前台要畫的專題清單。
 * 沒有標題的項目沒東西可讀也沒東西可點，直接略過；最多 3 筆；格式不對一律回空陣列（整區隱藏）。
 */
export function pickFeaturedTopics(raw) {
    const items = Array.isArray(raw?.items) ? raw.items : [];
    return items
        .filter((item) => item && typeof item === "object" && cleanText(item.title) !== "")
        .slice(0, MAX_TOPICS)
        .map((item, index) => ({
            key: item.id ?? `topic-${index}`,
            title: cleanText(item.title),
            summary: cleanText(item.summary),
            categoryLabel: cleanText(item.category_label),
            imageUrl: safeImageUrl(item.image_url),
            link: classifyLink(item.link_url),
        }));
}
