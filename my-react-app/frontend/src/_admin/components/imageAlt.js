/** 文件裡缺替代文字（alt）的圖片數量（稽核 FE7a-19）。 */
export function countImagesMissingAlt(doc) {
    let count = 0;
    const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'image' && !(node.attrs?.alt ?? '').trim()) count += 1;
        if (Array.isArray(node.content)) node.content.forEach(walk);
    };
    walk(doc);
    return count;
}
