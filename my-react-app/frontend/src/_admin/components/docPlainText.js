// 把 TipTap／ProseMirror 文件轉成純文字，給「複製我的版本」用（WP-8 追加）。
// 只求內容可讀、可貼回去重打：區塊之間換行，圖片與影片以占位文字標示。
//
// WP-8 追加：清單與表格要保留結構。原本只是把所有文字節點串起來、在區塊後補換行，
// 表格的儲存格（tableCell／tableHeader 不是區塊）會黏成一長串、清單也看不出哪幾行是同一項，
// 貼回去重打時很難還原。所以清單加上項目符號（無序「・」、有序編號、待辦 [ ]／[x]，巢狀時縮排），
// 表格每一列一行、儲存格之間用「 | 」分隔。

// 會自成一段（前後要換行）的節點；不在這裡的（text、hardBreak、行內標記）視為行內內容，直接串接
const BLOCK_TYPES = new Set([
    'paragraph', 'heading', 'blockquote', 'codeBlock', 'callout', 'horizontalRule', 'image', 'youtube',
    'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'table', 'tableRow', 'tableCell', 'tableHeader',
]);
const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);
const CELL_SEPARATOR = ' | ';
const INDENT = '  ';

const childrenOf = (node) => (Array.isArray(node?.content) ? node.content : []);

function nodeText(node, depth) {
    if (!node || typeof node !== 'object') return '';
    if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'image') return `[圖片${node.attrs?.alt ? `：${node.attrs.alt}` : ''}]`;
    if (node.type === 'youtube') return '[影片]';
    if (node.type === 'horizontalRule') return '';
    if (LIST_TYPES.has(node.type)) return listText(node, depth);
    if (node.type === 'table') return tableText(node, depth);
    return childrenText(node, depth);
}

// 相鄰的行內節點串成同一行，區塊節點之間換行
function childrenText(node, depth) {
    const parts = [];
    let inline = null;
    childrenOf(node).forEach((child) => {
        if (BLOCK_TYPES.has(child?.type)) {
            if (inline !== null) parts.push(inline);
            inline = null;
            parts.push(nodeText(child, depth));
        } else {
            inline = (inline ?? '') + nodeText(child, depth);
        }
    });
    if (inline !== null) parts.push(inline);
    return parts.join('\n');
}

function listMarker(list, item, index) {
    if (list.type === 'orderedList') {
        const start = Number.isInteger(list.attrs?.start) ? list.attrs.start : 1;
        return `${start + index}. `;
    }
    if (list.type === 'taskList') return item?.attrs?.checked ? '[x] ' : '[ ] ';
    return '・ ';
}

// 清單項目：第一段接在符號後面；同一項的其他段落與段內換行縮排對齊；巢狀清單自己處理縮排（depth + 1）
function listText(list, depth) {
    const indent = INDENT.repeat(depth);
    return childrenOf(list).map((item, index) => {
        const lines = [];
        let first = true;
        childrenOf(item).forEach((child) => {
            if (LIST_TYPES.has(child?.type)) {
                lines.push(nodeText(child, depth + 1));
                return;
            }
            nodeText(child, depth + 1).split('\n').forEach((line) => {
                if (first) {
                    // 空的第一段只留符號，不要在行尾多一個空白
                    lines.push(`${indent}${listMarker(list, item, index)}${line}`.trimEnd());
                    first = false;
                } else {
                    lines.push(line ? `${indent}${INDENT}${line}` : '');
                }
            });
        });
        // 空的項目（只有符號）也保留一行，項目編號才不會對不起來
        if (first) lines.unshift(`${indent}${listMarker(list, item, index)}`.trimEnd());
        return lines.join('\n');
    }).join('\n');
}

// 表格：一列一行、儲存格以分隔符隔開；儲存格內的換行壓成空白，不然會把同一列拆成好幾行
function tableText(table, depth) {
    return childrenOf(table)
        .map((row) => childrenOf(row)
            .map((cell) => childrenText(cell, depth).replace(/\s*\n+\s*/g, ' ').trim())
            .join(CELL_SEPARATOR))
        .join('\n');
}

export function docToPlainText(doc) {
    if (!doc || typeof doc !== 'object') return '';
    return nodeText(doc, 0).replace(/\n{3,}/g, '\n\n').trim();
}
