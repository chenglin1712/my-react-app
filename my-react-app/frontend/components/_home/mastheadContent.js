const MAX_MARQUEE_ITEMS = 10;

const cleanText = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * 從公開設定（/adminapi/public/homepage-config/）取出報頭與跑馬燈要顯示的內容。
 * 開關關閉或內容空白就回空值，呼叫端據此「不輸出元素、不留空位」（HOMEPAGE_CONTRACT.md 4.3）。
 * 後端已經依開關清空內容並驗證長度，這裡再防一次：型別不對、全空白、超過 10 項的資料都不會畫出來。
 */
export function pickMastheadContent(config = {}) {
    const marqueeItems = config.show_marquee !== false && Array.isArray(config.marquee_items)
        ? config.marquee_items.map(cleanText).filter(Boolean).slice(0, MAX_MARQUEE_ITEMS)
        : [];
    return {
        marqueeItems,
        tagline: config.show_tagline !== false ? cleanText(config.tagline) : "",
        quote: config.show_quote !== false ? cleanText(config.quote_text) : "",
    };
}
