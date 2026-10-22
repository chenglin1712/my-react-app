const MAX_SOURCES = 3;

// 對話紀錄存在 localStorage，不可信：後端核對過官方網域，這裡仍只接受 https 且不帶帳號密碼的網址。
// 官方網站查證（路線圖 #19）的來源清單。
export function cleanSources(sources) {
    const seen = new Set();
    const clean = [];
    for (const item of Array.isArray(sources) ? sources : []) {
        if (clean.length === MAX_SOURCES) break;
        if (!item || typeof item.url !== "string" || item.url.length > 500 || seen.has(item.url)) continue;
        let parsed;
        try {
            parsed = new URL(item.url);
        } catch {
            continue;
        }
        if (parsed.protocol !== "https:" || parsed.username || parsed.password) continue;
        seen.add(item.url);
        const title = typeof item.title === "string" ? item.title.trim().slice(0, 80) : "";
        clean.push({ url: parsed.href, title: title || parsed.hostname, host: parsed.hostname });
    }
    return clean;
}
