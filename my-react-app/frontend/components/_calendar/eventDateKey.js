import { TAIPEI_TIME_ZONE } from "@utils/calendarEvents";

/**
 * 稽核 FE6-14：行事曆原本用 event.start.split("T")[0] 當日期鍵。
 * - 讀書計畫的 start 直接沿用 AI 回傳值，後端也接受 Z 結尾的 UTC（例如 2026-10-23T18:00:00Z
 *   其實是台灣 10/24 02:00），卻被掛到 10/23，顯示時間又用台灣時間格式化成 02:00；
 * - start 缺少或不是字串時 split 會丟 TypeError，單筆壞資料讓整份行事曆變成「載入失敗」。
 *
 * 只認嚴格的 ISO 8601 寫法（先去掉前後空白，日期與時間之間可用 T 或空格）：
 * - 只有日期（YYYY-MM-DD）：直接當鍵；
 * - 有日期時間、沒有時區：視為台灣本地時間，直接取日期部分（不交給 Date.parse，否則會依瀏覽器時區解讀）；
 * - 有 Z 或 ±hh:mm：換算成台灣時間再取年月日（與 formatEventTime 一致）。
 * 其他寫法（斜線、單位數月日、不存在的日期或時間）一律回傳 null，由呼叫端略過並記錄。
 * 不再把認不得的字串丟給 Date.parse：V8 的 Date.parse 很寬鬆，會把 2026-02-30 自動進位成 3/2，
 * 也會用瀏覽器本地時區解讀非 ISO 寫法，海外瀏覽器可能歸錯日。
 *
 * 斜線格式（2026/10/23）不接受：專案寫入行事曆的來源只有行事曆頁（buildEventRange 產生 +08:00 ISO）
 * 與讀書計畫（後端 AIModel/services.py 的 _parse_event_time 以 fromisoformat 驗證後輸出 isoformat()，
 * 一律是 +08:00 ISO），不會產生斜線格式。
 */
const DATE_PART = String.raw`(\d{4})-(\d{2})-(\d{2})`;
const TIME_PART = String.raw`(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?`;
const DATE_ONLY = new RegExp(`^${DATE_PART}$`);
const DATETIME = new RegExp(`^${DATE_PART}[T ]${TIME_PART}(Z|[+-]\\d{2}:\\d{2})?$`);

const taipeiDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});

const pad2 = (n) => String(n).padStart(2, "0");

// 用年月日重新組回 UTC 日期再核對（含閏年），月份或日期超出範圍就不合法
function isValidYmd(y, m, d) {
    if (m < 1 || m > 12 || d < 1) return false;
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function isValidOffset(offset) {
    if (offset === "Z") return true;
    const [hh, mm] = offset.slice(1).split(":").map(Number);
    return hh <= 14 && mm <= 59;
}

export function eventDateKey(event) {
    const raw = event?.start;
    if (typeof raw !== "string") return null;
    const start = raw.trim();
    if (!start) return null;

    const dateOnly = DATE_ONLY.exec(start);
    if (dateOnly) {
        const [, y, m, d] = dateOnly.map(Number);
        return isValidYmd(y, m, d) ? start : null;
    }

    const match = DATETIME.exec(start);
    if (!match) return null;
    const [, ys, ms, ds, hs, mins, ss = "0", fraction = "", offset] = match;
    const [y, m, d, h, min, sec] = [ys, ms, ds, hs, mins, ss].map(Number);
    if (!isValidYmd(y, m, d) || h > 23 || min > 59 || sec > 59) return null;
    const dateKey = `${ys}-${ms}-${ds}`;
    if (!offset) return dateKey;
    if (!isValidOffset(offset)) return null;

    // 格式已確認合法，組成標準寫法再換算（T 分隔、毫秒最多 3 位），避免各瀏覽器對空格或長小數的解析差異
    const millis = fraction ? `.${fraction.slice(1, 4).padEnd(3, "0")}` : "";
    const iso = `${dateKey}T${pad2(h)}:${pad2(min)}:${pad2(sec)}${millis}${offset}`;
    const time = Date.parse(iso);
    if (Number.isNaN(time)) return null;
    // en-CA 的格式就是 YYYY-MM-DD；用 formatToParts 組字串，不依賴各瀏覽器的分隔符號
    const parts = Object.fromEntries(
        taipeiDateFormatter.formatToParts(new Date(time)).map((p) => [p.type, p.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
}

/** 依日期分組；無法判斷日期的事件不放進畫面，回傳在 skipped 裡讓呼叫端記錄。 */
export function groupEventsByDate(events) {
    const grouped = {};
    const skipped = [];
    (Array.isArray(events) ? events : []).forEach((event) => {
        const key = eventDateKey(event);
        if (!key) {
            skipped.push(event);
            return;
        }
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(event);
    });
    return { grouped, skipped };
}
