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

// 每個已發布的專題都有自己的文章頁（/topics/<id>），卡片一律連過去；沒有整數 id 的資料不能點
const articleLink = (item) => (Number.isInteger(item.id) ? { href: `/topics/${item.id}`, external: false } : null);

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
            link: articleLink(item),
        }));
}

// 後台還沒發布任何專題時顯示的示意卡（對齊設計稿）：沒有連結，版面先佔好；發布專題後自動換成真的
export const DEMO_TOPICS = [
    { key: "demo-1", title: "織紋裡的語言", categoryLabel: "專題", summary: "示意文案：一段關於族語與織紋的導讀，之後換成編輯寫的內容。", imageUrl: "", link: null },
    { key: "demo-2", title: "今天練一句", categoryLabel: "學習", summary: "示意文案：每日一句短練習。", imageUrl: "", link: null },
    { key: "demo-3", title: "聽長輩說", categoryLabel: "聲音", summary: "示意文案：收錄的語音與故事。", imageUrl: "", link: null },
];
