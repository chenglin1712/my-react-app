// LightMarkdown 的純文字處理（不含 React）：切成區塊，以及給報讀器與複製用的去記號版本。
const BULLET = /^\s*[-*•]\s+(.*)$/;
const ORDERED = /^\s*\d{1,2}[.)]\s+(.*)$/;
export const BOLD = /\*\*([^*\n]+?)\*\*/g;

export function parseBlocks(text) {
    const blocks = [];
    let current = null;
    const flush = () => { if (current) blocks.push(current); current = null; };
    for (const line of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
        const bullet = BULLET.exec(line);
        const ordered = bullet ? null : ORDERED.exec(line);
        if (bullet || ordered) {
            const type = bullet ? "ul" : "ol";
            if (current?.type !== type) { flush(); current = { type, items: [] }; }
            current.items.push((bullet || ordered)[1]);
        } else if (line.trim() === "") {
            flush();
        } else {
            if (current?.type !== "p") { flush(); current = { type: "p", lines: [] }; }
            current.lines.push(line);
        }
    }
    flush();
    return blocks;
}

// 給報讀器與「複製」用的純文字：拿掉粗體記號，其餘（含條列的 "- "）保持原樣
export function stripLightMarkdown(text) {
    return String(text ?? "").replace(BOLD, "$1");
}
