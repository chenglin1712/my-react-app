// 後台公告（backend/adminapi 的 Announcement，見 /adminapi/public/announcements/）轉成前台消息列表用的形狀。
// 首頁的「最新消息」與「所有公告」頁共用，兩邊顯示的日期與分類標籤才會一致。
//
// - start_date 優先用 display_date_text（活動／考試本身的起訖日期文字），沒有的話才退回格式化的 publish_at——
//   後台自建的公告沒有 display_date_text，這時 publish_at 才是唯一能顯示的日期。
// - tag 優先用 source_tag（爬蟲來源原始的分類文字，保留卡片標籤顏色的多樣性），
//   沒有的話才退回四個固定分類的中文標籤。

export const ANNOUNCEMENT_CATEGORY_LABELS = { announcement: "公告", activity: "活動", exam: "考試", maintenance: "系統維護" };

// formatter 不帶任何跟單筆公告相關的狀態，提到模組層重用同一個實例
const PUBLISH_DATE_FORMATTER = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" });
const formatPublishDate = (publishAt) => (publishAt ? PUBLISH_DATE_FORMATTER.format(new Date(publishAt)) : "");

// 封面圖只收 https：後端已檢查，這裡是顯示前的第二道（稽核 FE-3），資料庫裡若有舊的或被竄改的
// javascript:、data:、http: 網址就不顯示。連結不在這裡過濾，由 isExternalUrl／ExternalLink 把關。
const safeCoverImage = (url) => {
    if (typeof url !== "string" || url.includes("\\")) return null;
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" && parsed.hostname && !parsed.username && !parsed.password ? url : null;
    } catch {
        return null;
    }
};

export const mapAnnouncementToNewsItem = (item) => ({
    id: item.id,
    title: item.title,
    detail: item.link_url || "",
    image: safeCoverImage(item.cover_image_url),
    start_date: item.display_date_text || formatPublishDate(item.publish_at),
    end_date: null,
    // 三層退回都落空時（source_tag、分類標籤、category 本身皆缺）統一退回「最新消息」
    tag: item.source_tag || ANNOUNCEMENT_CATEGORY_LABELS[item.category] || item.category || "最新消息",
});

// 首頁「最新消息」最多顯示幾則：首頁只放最新的幾則，其餘到「所有公告」頁看
export const HOME_NEWS_MAX = 4;
