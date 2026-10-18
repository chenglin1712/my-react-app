const MAX_MARQUEE_ITEMS = 10;

const cleanText = (value) => (typeof value === "string" ? value.trim() : "");

// 後台沒填時的預設文字（對齊首頁雜誌版設計）。後台填了就用後台的；要整個隱藏就關掉對應的顯示開關。
export const DEFAULT_MARQUEE_ITEMS = ["讓語言回家", "單詞查詢", "翻譯", "影像辨識", "遊戲專區", "測驗", "筆記"];
export const DEFAULT_TAGLINE = "讓語言回家";
export const DEFAULT_QUOTE = "每一種語言，都是一座回得去的家。";
// 第一屏大標題下的說明；後台沒有對應欄位，跟著標語的顯示開關一起出現
export const HOME_LEDE = "用查詞、聽發音和故事，把族語帶回日常。";

/**
 * 從公開設定（/adminapi/public/homepage-config/）取出報頭與跑馬燈要顯示的內容。
 * 開關關閉就回空值，呼叫端據此「不輸出元素、不留空位」（HOMEPAGE_CONTRACT.md 4.3）；
 * 開關開著但內容空白時退回上面的預設文字。型別不對、全空白、超過 10 項的資料都不會畫出來。
 */
export function pickMastheadContent(config = {}) {
    const items = Array.isArray(config.marquee_items)
        ? config.marquee_items.map(cleanText).filter(Boolean).slice(0, MAX_MARQUEE_ITEMS)
        : [];
    return {
        marqueeItems: config.show_marquee !== false ? (items.length > 0 ? items : DEFAULT_MARQUEE_ITEMS) : [],
        tagline: config.show_tagline !== false ? cleanText(config.tagline) || DEFAULT_TAGLINE : "",
        quote: config.show_quote !== false ? cleanText(config.quote_text) || DEFAULT_QUOTE : "",
    };
}
