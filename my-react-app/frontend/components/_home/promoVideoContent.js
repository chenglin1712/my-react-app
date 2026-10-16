const cleanText = (value) => (typeof value === "string" ? value.trim() : "");

// 影片、封面、字幕只能是自己網域的相對路徑（HOMEPAGE_CONTRACT.md 第 1 節第 5 點）。
// 後端本來就只輸出相對路徑，前端再擋一次：外部網址、協定相對網址、反斜線一律當作沒有。
export const safeMediaUrl = (value) => {
    if (typeof value !== "string") return null;
    const url = value.trim();
    if (!url.startsWith("/") || url.startsWith("//") || url.includes("\\")) return null;
    return url;
};

/**
 * 公開設定的 promo_video → 前台要用的樣子；沒有啟用中的影片（null、非物件）回 null。
 * 物件只要存在就保留（即使缺檔），好讓前台顯示封面、錯誤說明與逐字稿，不是整個消失。
 * available 為 false 或沒有可用的 video_url，一律視為無法播放。
 */
export function pickPromoVideo(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const videoUrl = safeMediaUrl(raw.video_url);
    const duration = Number(raw.duration_seconds);
    return {
        id: raw.id ?? null,
        title: cleanText(raw.title),
        description: cleanText(raw.description),
        transcript: typeof raw.transcript === "string" ? raw.transcript.trim() : "",
        videoUrl,
        coverUrl: safeMediaUrl(raw.cover_url),
        captionUrl: safeMediaUrl(raw.caption_url),
        durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : 0,
        playable: raw.available !== false && Boolean(videoUrl),
    };
}

/** 秒數 → m:ss（影片約 5 到 7 分鐘，不需要小時） */
export function formatClock(seconds) {
    const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
