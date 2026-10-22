/**
 * 每週學習摘要（路線圖 #25）的讀取整理。文件 users/{uid}/weeklyDigest/current 只有後端排程能寫，
 * 但仍不信任形狀：欄位型別、長度、數量一律在這裡清過再顯示。
 */

export const DIGEST_MAX_AGE_DAYS = 9;      // 排程每週產生一次；超過這個天數沒更新就當作過期，不再顯示

const MAX_SUMMARY = 200;
const MAX_WORDS = 5;

const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

const toMillis = (value) => {
    if (typeof value?.toMillis === "function") return value.toMillis();
    if (value instanceof Date) return value.getTime();
    return null;
};

/** 整理成畫面用的資料；已關閉、過期、沒有摘要文字就回 null。 */
export function cleanDigest(raw, nowMs = Date.now()) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.dismissedAt) return null;
    const generated = toMillis(raw.generatedAt);
    if (generated !== null && nowMs - generated > DIGEST_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) return null;
    const summary = typeof raw.summary === "string" ? raw.summary.trim().slice(0, MAX_SUMMARY) : "";
    if (!summary) return null;

    const stats = raw.stats && typeof raw.stats === "object" ? raw.stats : {};
    const words = (Array.isArray(raw.reviewWords) ? raw.reviewWords : [])
        .filter((item) => item && typeof item.word === "string" && item.word.trim())
        .slice(0, MAX_WORDS)
        .map((item) => ({ word: item.word.trim().slice(0, 50), wrong: count(item.wrong) }));
    return {
        summary,
        fromModel: raw.summarySource === "model",
        stats: { attempts: count(stats.attempts), questions: count(stats.questions), correct: count(stats.correct) },
        words,
    };
}
