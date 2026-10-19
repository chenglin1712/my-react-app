/**
 * 專題文章的內文是純文字：空一行分成新的一段，以「## 」開頭的一行是小標。
 * 轉成區塊清單後由 React 以文字節點輸出，所以不需要（也不做）HTML 清理；內文裡的 < > 會原樣顯示。
 *
 * 一段之內的單一換行保留為段落內的換行（詩、地址、清單這類內容不會被吃掉）。
 */
export function parseArticleBody(text) {
    if (typeof text !== "string") return [];
    const blocks = [];
    text
        .replace(/\r\n?/g, "\n")
        .split(/\n[ \t\u3000]*\n/)
        .forEach((chunk) => {
            // 同一個區塊裡小標與內文連在一起（沒空行）時，小標獨立成一個區塊
            let paragraph = [];
            const flush = () => {
                const joined = paragraph.join("\n").trim();
                if (joined) blocks.push({ type: "p", text: joined });
                paragraph = [];
            };
            chunk.split("\n").forEach((line) => {
                const heading = /^##[ \u3000]+(.*\S)\s*$/.exec(line);
                if (heading) {
                    flush();
                    blocks.push({ type: "h2", text: heading[1] });
                } else {
                    paragraph.push(line);
                }
            });
            flush();
        });
    return blocks;
}

/** "2026-10-19" → "2026 年 10 月 19 日"；格式不對就回空字串（不顯示日期，也不顯示 Invalid Date） */
export function formatArticleDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof value === "string" ? value : "");
    if (!match) return "";
    return `${match[1]} 年 ${Number(match[2])} 月 ${Number(match[3])} 日`;
}
