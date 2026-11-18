// 遊戲專區的個人進度（P4-1）。
//
// 資料來源與隱私：目前伺服器上沒有任何遊戲紀錄，所以這份進度只存在「這台裝置的瀏覽器」
// （localStorage），不上傳、不跟帳號綁定；清除瀏覽器資料或換裝置就會歸零。
// 只記每款遊戲「最高分」「最近玩的族語與日期」，以及全部遊戲合起來的「有玩的日期」（算連續天數）。
// 沒有紀錄的欄位呼叫端就不顯示，不會用 0 或假資料充數。

export const PROGRESS_KEY = "yy.game.progress.v1";
const MAX_DAYS = 90;

const pad = (n) => String(n).padStart(2, "0");
// 用本地日期（不是 UTC）：晚上十一點玩的遊戲要算當天
export const dayKey = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const empty = () => ({ games: {}, days: [] });

export function readProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY));
    if (!raw || typeof raw !== "object") return empty();
    const games = {};
    for (const [id, g] of Object.entries(raw.games && typeof raw.games === "object" ? raw.games : {})) {
      if (!g || typeof g !== "object") continue;
      games[id] = {
        best: Number.isFinite(g.best) ? g.best : null,
        lastTribe: typeof g.lastTribe === "string" ? g.lastTribe : null,
        lastAt: Number.isFinite(g.lastAt) ? g.lastAt : null,
      };
    }
    const days = Array.isArray(raw.days) ? raw.days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-MAX_DAYS) : [];
    return { games, days };
  } catch {
    return empty();
  }
}

/** 一局結束時呼叫。pct 是 0–100 的分數（答對率或平均分）。寫不進去（無痕模式等）就靜默略過。 */
export function recordGameResult(gameId, { tribe = null, pct, now = new Date() } = {}) {
  if (!gameId || !Number.isFinite(pct)) return;
  const progress = readProgress();
  const prev = progress.games[gameId];
  const score = Math.max(0, Math.min(100, Math.round(pct)));
  progress.games[gameId] = {
    best: prev?.best != null ? Math.max(prev.best, score) : score,
    lastTribe: tribe || prev?.lastTribe || null,
    lastAt: now.getTime(),
  };
  const today = dayKey(now);
  progress.days = [...new Set([...progress.days, today])].sort().slice(-MAX_DAYS);
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch { /* 寫不進去就不記錄 */ }
}

/** 使用者按「清除進度」：整份刪掉。 */
export function clearProgress() {
  try { localStorage.removeItem(PROGRESS_KEY); } catch { /* 刪不掉就算了 */ }
}

/** 連續有玩的天數：今天或昨天有玩才算「還在連續中」；都沒有就是 0。 */
export function currentStreak(days, now = new Date()) {
  const set = new Set(days);
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!set.has(dayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);          // 今天還沒玩：從昨天往回數，不讓使用者一早就看到連續中斷
    if (!set.has(dayKey(cursor))) return 0;
  }
  let streak = 0;
  while (set.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function hasAnyProgress(progress) {
  return Object.values(progress.games).some((g) => g.best != null || g.lastAt != null);
}
