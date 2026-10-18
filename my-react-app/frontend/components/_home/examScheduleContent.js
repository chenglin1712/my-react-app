// 首頁「族語認證時程」的資料整理（來源：後端 /crawler/exam_schedule/，爬官網日程表再套後台人工覆寫）。
// 後端回 { session, phases: [{ phase, start_date, end_date }] }；日期是 'YYYY-MM-DD'。

// 期程 -> 相關頁面網址（只有報名與成績有對外頁面）。網址是固定的官方站，不是後台輸入的內容。
const PHASE_ACTION_URLS = {
    報名: "https://exam.sce.ntnu.edu.tw/abst/signup/login.php",
    成績: "https://exam.sce.ntnu.edu.tw/abst/score_search.php",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 'YYYY-MM-DD'（或帶時間的 ISO）轉成當地時區那天的 00:00。直接 new Date('2026-10-12') 會當成 UTC，
// 在 UTC 以西的時區會變成前一天。格式不對回 null。
export function parseDay(value) {
    if (typeof value !== "string") return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
}

/** 把後端資料整理成清單：略過沒有期程名稱或日期壞掉的項目，依開始日排序。資料不是預期的形狀就回 null。 */
export function pickExamSchedule(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.phases)) return null;
    const phases = data.phases
        .map((item) => {
            const start = parseDay(item?.start_date);
            const name = typeof item?.phase === "string" ? item.phase.trim() : "";
            if (!start || !name) return null;
            const end = parseDay(item.end_date);
            return { phase: name, start, end: end && end > start ? end : null, url: PHASE_ACTION_URLS[name] ?? null };
        })
        .filter(Boolean)
        .sort((a, b) => a.start - b.start);
    // 「115年度原住民族語言能力認證日程表」之類，去掉結尾的「日程表」只留屆次名稱
    const session = typeof data.session === "string" ? data.session.replace(/日程表$/, "").trim() : "";
    return { session, phases };
}

/** 這個期程相對於 now 的狀態：已結束、進行中、還沒到（附還有幾天）。以「天」為單位，結束那天算進行中。 */
export function phaseStatus(phase, now = new Date()) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const last = phase.end ?? phase.start;
    if (today > last) return { state: "past", daysLeft: 0 };
    if (today >= phase.start) return { state: "current", daysLeft: 0 };
    return { state: "upcoming", daysLeft: Math.round((phase.start - today) / MS_PER_DAY) };
}

const pad = (n) => String(n);
export const formatMonthDay = (date) => `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
