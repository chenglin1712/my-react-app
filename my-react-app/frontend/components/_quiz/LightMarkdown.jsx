import { Fragment } from "react";
import { BOLD, parseBlocks } from "./markdownBlocks";

// AI 助手回覆的輕量格式（路線圖 #14）。只認三種語法：換行／段落、條列（- * •）與編號（1.）、**粗體**。
// 安全設計：全部輸出成 React 元素與文字節點，不用 dangerouslySetInnerHTML，也不解析 HTML、連結、圖片，
// 所以 <script>、<img onerror> 之類的內容只會被當成字面文字顯示；未閉合的 ** 也維持字面（串流到一半時常見）。

function renderInline(text) {
    const parts = [];
    let last = 0;
    let key = 0;
    for (const match of text.matchAll(BOLD)) {
        if (match.index > last) parts.push(text.slice(last, match.index));
        parts.push(<strong key={key++}>{match[1]}</strong>);
        last = match.index + match[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
}

const LightMarkdown = ({ text, ...rest }) => (
    <div className="bot-md" {...rest}>
        {parseBlocks(text).map((block, i) => {
            if (block.type === "p") {
                return (
                    <p key={i}>
                        {block.lines.map((line, j) => (
                            <Fragment key={j}>{j > 0 && <br />}{renderInline(line)}</Fragment>
                        ))}
                    </p>
                );
            }
            const List = block.type;
            return (
                <List key={i}>
                    {block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
                </List>
            );
        })}
    </div>
);

export default LightMarkdown;
