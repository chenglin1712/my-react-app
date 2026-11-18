// 學習動機機制（P6-4）：連續學習天數、今日目標、里程碑。
//
// 規格（使用者在 X7 選「本輪就做」，細節由實作者定，列在這裡與檢查清單備註）：
// - 什麼算一次「學習活動」：完成一次測驗、完成一局遊戲、新增一個收藏。其他操作不算，避免靠亂點衝數字。
// - 資料與隱私：只存在這台裝置的瀏覽器（localStorage），不上傳、不跟帳號綁定、不改 Firestore 規則；
//   清除瀏覽器資料或換裝置就歸零，畫面上會明講。每個帳號各自一份（鍵帶 uid），同一台電腦換帳號不會混在一起。
// - 一天的界線：台灣時間（Asia/Taipei）午夜，不論使用者的裝置設在哪個時區。
// - 連續天數：每天至少一次學習活動；今天還沒學習時從昨天往回數，不讓使用者一早就看到連續中斷。
// - 今日目標：每天 3 次學習活動。
// - 里程碑：連續 3、7、14、30、60、100 天。
// 沒有紀錄時畫面只顯示「開始你的第一天」，不用 0 或假資料充數。
// 已知限制：寫入是「讀、加一、寫」，兩個分頁在同一毫秒各記一次時可能只留下一次。活動都是人在操作，
// 相隔至少數秒，這個機率可以忽略，不值得為此引入鎖；要更嚴謹就得改存伺服器（目前刻意不做）。

export const ACTIVITY_KEY_PREFIX = "yy.study.activity.v1:";
export const ACTIVITY_EVENT = "yy-study-activity";
export const DAILY_GOAL = 3;
export const MILESTONES = [3, 7, 14, 30, 60, 100];
const MAX_DAYS = 400;
export const ACTIVITY_KINDS = ["quiz", "game", "favorite"];

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" });
/** 台灣時間的日期字串 YYYY-MM-DD（用 formatToParts 自己組，不靠某個語系的輸出格式） */
export const taipeiDayKey = (date = new Date()) => {
  const parts = Object.fromEntries(DAY_FORMAT.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

/** 距離下一個台灣午夜還有幾毫秒（台灣沒有夏令時間，固定 UTC+8） */
export const msUntilTaipeiMidnight = (now = new Date()) => {
  const nextMidnightUtc = keyToUtcMs(taipeiDayKey(now)) + 86400000 - 8 * 3600000;
  return Math.max(1000, nextMidnightUtc - now.getTime());
};

const keyToUtcMs = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const shiftDay = (key, delta) => taipeiDayKey(new Date(keyToUtcMs(key) + delta * 86400000 + 12 * 3600000));

const storageKey = (uid) => `${ACTIVITY_KEY_PREFIX}${uid}`;

export function readActivity(uid) {
  if (!uid) return {};
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(uid)));
    if (!raw || typeof raw !== "object" || typeof raw.days !== "object" || raw.days === null) return {};
    const days = {};
    for (const [key, count] of Object.entries(raw.days)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(count) && count > 0) days[key] = Math.floor(count);
    }
    return days;
  } catch {
    return {};
  }
}

/** 完成一次學習活動時呼叫。沒有 uid（未登入）或寫不進去（無痕模式等）就靜默略過。 */
export function recordLearningActivity(uid, kind, now = new Date()) {
  if (!uid || !ACTIVITY_KINDS.includes(kind)) return;
  const days = readActivity(uid);
  const today = taipeiDayKey(now);
  days[today] = (days[today] || 0) + 1;
  const keep = Object.keys(days).sort().slice(-MAX_DAYS);
  const trimmed = Object.fromEntries(keep.map((k) => [k, days[k]]));
  try {
    localStorage.setItem(storageKey(uid), JSON.stringify({ days: trimmed }));
  } catch {
    return;
  }
  try {
    window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT, { detail: { uid } }));
  } catch { /* 沒有 window 事件就算了，畫面下次載入會讀到 */ }
}

export function clearActivity(uid) {
  if (!uid) return;
  try { localStorage.removeItem(storageKey(uid)); } catch { /* 刪不掉就算了 */ }
  try { window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT, { detail: { uid } })); } catch { /* 同上 */ }
}

/** 由每天的次數算出畫面要的數字 */
export function computeStudyStats(days, now = new Date()) {
  const today = taipeiDayKey(now);
  const todayCount = days[today] || 0;
  const hasAny = Object.keys(days).length > 0;

  // 連續天數：今天有就從今天數，沒有就從昨天數
  let cursor = todayCount > 0 ? today : shiftDay(today, -1);
  let streak = 0;
  while (days[cursor] > 0) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }

  // 歷史最長連續
  const keys = Object.keys(days).sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const key of keys) {
    run = prev && shiftDay(prev, 1) === key ? run + 1 : 1;
    best = Math.max(best, run);
    prev = key;
  }

  const reachedMilestone = todayCount > 0 && MILESTONES.includes(streak) ? streak : null;
  const nextMilestone = MILESTONES.find((m) => m > streak) ?? null;
  return {
    hasAny,
    dayKey: today,
    today: todayCount,
    goal: DAILY_GOAL,
    goalMet: todayCount >= DAILY_GOAL,
    streak,
    best,
    reachedMilestone,
    nextMilestone,
    daysToNext: nextMilestone ? nextMilestone - streak : null,
  };
}
