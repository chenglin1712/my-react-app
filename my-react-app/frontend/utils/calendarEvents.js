/**
 * 行事曆事件的欄位約定與判讀（Firestore calendar/{uid}.events 陣列裡的每一筆）。
 *
 * 事件原本只有 summary／description／start／end，沒有「是不是全天」也沒有「是什麼類型」：
 * - 全天只能靠「開始時間剛好 00:00」猜，使用者真的選 00:00 開始的事件也會被當成全天；
 * - 「前往測驗」按鈕靠事件文字有沒有「測驗」兩個字判斷，行程名稱剛好含這兩個字就會冒出按鈕。
 * 現在新寫入的事件都明確帶 allDay（布林）與 type（"quiz" | "general"）。
 * 舊事件沒有這兩個欄位，讀取時才用原本的猜法補上（isAllDayEvent／getEventType 的 fallback），
 * 所以不需要搬資料，舊行程照舊顯示。
 *
 * 時間固定是台灣時間（+08:00），顯示與判斷都指定 Asia/Taipei，使用者在海外也不會偏移。
 */

export const TAIPEI_OFFSET = "+08:00";
export const TAIPEI_TIME_ZONE = "Asia/Taipei";

export const EVENT_TYPE_GENERAL = "general";
export const EVENT_TYPE_QUIZ = "quiz";
const EVENT_TYPES = [EVENT_TYPE_GENERAL, EVENT_TYPE_QUIZ];

// 只給舊事件（沒有 type 欄位）使用的猜法
const LEGACY_QUIZ_PATTERN = /測驗/;

const pad = (n) => String(n).padStart(2, "0");

/** Date -> 台灣時間的 "HH:mm"（24 小時制） */
export function formatTaipeiTime(date) {
    return date.toLocaleTimeString("zh-TW", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone: TAIPEI_TIME_ZONE,
    });
}

/** "YYYY-MM-DD" 的下一天 */
function nextDateKey(dateKey) {
    const [y, m, d] = dateKey.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** 這筆事件是不是全天：有明確的 allDay 欄位就照它，舊事件才用「開始時間 00:00 或只有日期」猜。 */
export function isAllDayEvent(event) {
    if (typeof event?.allDay === "boolean") return event.allDay;
    const start = event?.start;
    if (typeof start !== "string" || !start) return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return true;
    const parsed = new Date(start);
    if (Number.isNaN(parsed.getTime())) return false;
    return formatTaipeiTime(parsed) === "00:00";
}

/** 事件類型："quiz" 會在行事曆顯示「前往測驗」。舊事件沒有 type，沿用文字含「測驗」的猜法。 */
export function getEventType(event) {
    if (EVENT_TYPES.includes(event?.type)) return event.type;
    return LEGACY_QUIZ_PATTERN.test(`${event?.summary ?? ""}${event?.description ?? ""}`)
        ? EVENT_TYPE_QUIZ
        : EVENT_TYPE_GENERAL;
}

/**
 * 依日期與可選的 HH:mm 組出開始與結束：
 * 沒填時間 = 全天（當天 00:00 到隔天 00:00）；有填 = 開始後 30 分鐘。
 */
export function buildEventRange(dateKey, timeValue) {
    if (!/^\d{2}:\d{2}$/.test(timeValue || "")) {
        return {
            start: `${dateKey}T00:00:00${TAIPEI_OFFSET}`,
            end: `${nextDateKey(dateKey)}T00:00:00${TAIPEI_OFFSET}`,
            allDay: true,
        };
    }
    const startMs = new Date(`${dateKey}T${timeValue}:00${TAIPEI_OFFSET}`).getTime();
    // 轉回 +08:00 的字串：先加 8 小時再用 UTC 欄位取值
    const shifted = new Date(startMs + 30 * 60 * 1000 + 8 * 60 * 60 * 1000);
    const endKey = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
    const endHm = `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
    return {
        start: `${dateKey}T${timeValue}:00${TAIPEI_OFFSET}`,
        end: `${endKey}T${endHm}:00${TAIPEI_OFFSET}`,
        allDay: false,
    };
}

/** 事件的時間文字：全天顯示「全天」，其餘 "HH:mm - HH:mm"（沒有結束時間就只有開始） */
export function formatEventTime(event) {
    const start = new Date(event?.start);
    if (Number.isNaN(start.getTime())) return "";
    if (isAllDayEvent(event)) return "全天";
    const end = new Date(event?.end);
    return Number.isNaN(end.getTime())
        ? formatTaipeiTime(start)
        : `${formatTaipeiTime(start)} - ${formatTaipeiTime(end)}`;
}

/** 寫入 Firestore 前補齊欄位：明確給的 allDay／type 優先，沒給的才用上面的判讀補上。 */
export function normalizeCalendarEvent(event) {
    return {
        ...event,
        allDay: isAllDayEvent(event),
        type: getEventType(event),
    };
}
