import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Blockquote } from '@tiptap/extension-blockquote';
import { Image as ImageExtension } from '@tiptap/extension-image';
import { ListItem, TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import {
    CALLOUT_TONES, FONT_SIZES, HIGHLIGHT_COLORS, IMAGE_ALIGNS, IMAGE_SIZES, TEXT_ALIGNS, TEXT_COLORS, safeHref,
} from '../../../components/_topic/richText';

/**
 * 專題文章（與隱私與資料、聯絡我們）編輯器可用的功能。要與後端白名單（backend/adminapi/article_doc.py）、
 * 前台渲染器（RichTextRenderer）三處一致：
 * - 所有「選項型」屬性（顏色、字級、對齊、提示框種類、圖片大小…）只存固定清單裡的名稱，不存色碼或 CSS。
 * - 每個容器節點的 content 都收在後端 _CONTAINERS 允許的範圍內，編輯時就做不出存不進去的結構
 *   （例如表格裡放標題、引用裡放表格）。
 * - 貼上來的內容（Word、Google 文件）只保留這裡認得的結構與樣式，其餘（字型、任意顏色、行內樣式）會被丟掉。
 */

const keysOf = (options) => new Set(options.map((o) => o.key).filter(Boolean));
const ALIGN_KEYS = keysOf(TEXT_ALIGNS);
const TEXT_COLOR_KEYS = keysOf(TEXT_COLORS);
const HIGHLIGHT_KEYS = keysOf(HIGHLIGHT_COLORS);
const FONT_SIZE_KEYS = keysOf(FONT_SIZES);
const TONE_KEYS = keysOf(CALLOUT_TONES);
const IMAGE_ALIGN_KEYS = keysOf(IMAGE_ALIGNS);
const IMAGE_SIZE_KEYS = keysOf(IMAGE_SIZES);

const only = (allowed, value) => (allowed.has(value) ? value : null);

// 圖片存 src／alt／title，另外多了 align、size 兩個固定選項；後端白名單不收其他屬性
const ArticleImage = ImageExtension.extend({
    addAttributes() {
        return {
            src: { default: null },
            alt: { default: null },
            title: { default: null },
            align: {
                default: null,
                parseHTML: (el) => only(IMAGE_ALIGN_KEYS, el.getAttribute('data-align')),
                renderHTML: (attrs) => (attrs.align ? { 'data-align': attrs.align } : {}),
            },
            size: {
                default: null,
                parseHTML: (el) => only(IMAGE_SIZE_KEYS, el.getAttribute('data-size')),
                renderHTML: (attrs) => (attrs.size ? { 'data-size': attrs.size } : {}),
            },
        };
    },
});

// 段落與標題的對齊。貼上時只讀 text-align（Word、Google 文件的段落對齊會保留），值不在清單內就忽略
const TextAlign = Extension.create({
    name: 'textAlign',
    addGlobalAttributes() {
        return [{
            types: ['paragraph', 'heading'],
            attributes: {
                textAlign: {
                    default: null,
                    parseHTML: (el) => {
                        const value = only(ALIGN_KEYS, el.style?.textAlign || el.getAttribute('data-align'));
                        return value === 'left' ? null : value;
                    },
                    renderHTML: (attrs) => (attrs.textAlign ? { 'data-align': attrs.textAlign } : {}),
                },
            },
        }];
    },
    addCommands() {
        const types = ['paragraph', 'heading'];
        return {
            setTextAlign: (align) => ({ commands }) => {
                if (!ALIGN_KEYS.has(align)) return false;
                const value = align === 'left' ? null : align;
                return types.map((type) => commands.updateAttributes(type, { textAlign: value })).some(Boolean);
            },
        };
    },
    addKeyboardShortcuts() {
        return {
            'Mod-Shift-l': () => this.editor.commands.setTextAlign('left'),
            'Mod-Shift-e': () => this.editor.commands.setTextAlign('center'),
            'Mod-Shift-r': () => this.editor.commands.setTextAlign('right'),
            'Mod-Shift-j': () => this.editor.commands.setTextAlign('justify'),
        };
    },
});

// 「選項型」文字樣式（文字色、螢光筆、字級）：只存固定清單裡的名稱，前台再對應到色盤與字級
function choiceMark({ name, tag, dataAttr, attr, allowed, setCommand, unsetCommand }) {
    return Mark.create({
        name,
        addAttributes() {
            return { [attr]: { default: null, renderHTML: (attrs) => (attrs[attr] ? { [dataAttr]: attrs[attr] } : {}) } };
        },
        parseHTML() {
            return [{ tag: `${tag}[${dataAttr}]`, getAttrs: (el) => (allowed.has(el.getAttribute(dataAttr)) ? { [attr]: el.getAttribute(dataAttr) } : false) }];
        },
        renderHTML({ HTMLAttributes }) {
            return [tag, HTMLAttributes, 0];
        },
        addCommands() {
            return {
                [setCommand]: (value) => ({ commands }) => (allowed.has(value) ? commands.setMark(this.name, { [attr]: value }) : false),
                [unsetCommand]: () => ({ commands }) => commands.unsetMark(this.name),
            };
        },
    });
}

const TextColor = choiceMark({ name: 'textColor', tag: 'span', dataAttr: 'data-text-color', attr: 'color', allowed: TEXT_COLOR_KEYS, setCommand: 'setTextColor', unsetCommand: 'unsetTextColor' });
const Highlight = choiceMark({ name: 'highlight', tag: 'mark', dataAttr: 'data-highlight', attr: 'color', allowed: HIGHLIGHT_KEYS, setCommand: 'setHighlight', unsetCommand: 'unsetHighlight' });
const FontSize = choiceMark({ name: 'fontSize', tag: 'span', dataAttr: 'data-font-size', attr: 'size', allowed: FONT_SIZE_KEYS, setCommand: 'setFontSize', unsetCommand: 'unsetFontSize' });

const Subscript = Mark.create({
    name: 'subscript',
    excludes: 'superscript',
    parseHTML: () => [{ tag: 'sub' }],
    renderHTML: () => ['sub', 0],
    addCommands() {
        return { toggleSubscript: () => ({ commands }) => commands.toggleMark(this.name) };
    },
    addKeyboardShortcuts() {
        return { 'Mod-,': () => this.editor.commands.toggleSubscript() };
    },
});

const Superscript = Mark.create({
    name: 'superscript',
    excludes: 'subscript',
    parseHTML: () => [{ tag: 'sup' }],
    renderHTML: () => ['sup', 0],
    addCommands() {
        return { toggleSuperscript: () => ({ commands }) => commands.toggleMark(this.name) };
    },
    addKeyboardShortcuts() {
        return { 'Mod-.': () => this.editor.commands.toggleSuperscript() };
    },
});

// 重點提示框：一整塊醒目的區塊，裡面只能放段落與清單
const Callout = Node.create({
    name: 'callout',
    group: 'block',
    content: '(paragraph | bulletList | orderedList | taskList)+',
    defining: true,
    addAttributes() {
        return {
            tone: {
                default: 'info',
                parseHTML: (el) => only(TONE_KEYS, el.getAttribute('data-tone')) ?? 'info',
                renderHTML: (attrs) => ({ 'data-tone': attrs.tone }),
            },
        };
    },
    parseHTML: () => [{ tag: 'aside[data-callout]' }],
    renderHTML({ HTMLAttributes }) {
        return ['aside', mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'rte-callout' }), 0];
    },
    addCommands() {
        return {
            setCallout: (tone) => ({ commands }) => (TONE_KEYS.has(tone) ? commands.wrapIn(this.name, { tone }) : false),
            setCalloutTone: (tone) => ({ commands }) => (TONE_KEYS.has(tone) ? commands.updateAttributes(this.name, { tone }) : false),
            unsetCallout: () => ({ commands }) => commands.lift(this.name),
        };
    },
});

// YouTube 影片：文件裡只存 11 碼影片代號（與選填的說明），編輯區只顯示佔位，不載入影片
const Youtube = Node.create({
    name: 'youtube',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
        return {
            videoId: { default: null, parseHTML: (el) => el.getAttribute('data-youtube-id') },
            title: { default: null, parseHTML: (el) => el.getAttribute('data-title') || null },
        };
    },
    parseHTML: () => [{ tag: 'div[data-youtube-id]' }],
    renderHTML({ node }) {
        const { videoId, title } = node.attrs;
        return ['div', { class: 'rte-youtube', 'data-youtube-id': videoId, ...(title ? { 'data-title': title } : {}) },
            ['span', { class: 'rte-youtube-label' }, `YouTube 影片${title ? `：${title}` : ''}`],
            ['span', { class: 'rte-youtube-id' }, videoId]];
    },
    addCommands() {
        return {
            setYoutube: (attrs) => ({ commands }) => commands.insertContent({ type: this.name, attrs }),
            setYoutubeTitle: (title) => ({ commands }) => commands.updateAttributes(this.name, { title }),
        };
    },
});

// 儲存格只放段落與清單，與後端 _CONTAINERS 的 tableCell／tableHeader 一致
const CELL_CONTENT = '(paragraph | bulletList | orderedList)+';
// TipTap 的儲存格預設多一個 align（給 Markdown 匯出用）；後端白名單只收 colspan／rowspan／colwidth
function withoutAlign() {
    const attrs = { ...(this.parent?.() ?? {}) };
    delete attrs.align;
    return attrs;
}
const ArticleListItem = ListItem.extend({ content: 'paragraph (paragraph | bulletList | orderedList)*' });
const ArticleTaskItem = TaskItem.extend({ content: 'paragraph (paragraph | bulletList | orderedList | taskList)*' });
const ArticleBlockquote = Blockquote.extend({ content: '(paragraph | heading | bulletList | orderedList | taskList | horizontalRule | image)+' });

export const articleExtensions = [
    StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        // 後端白名單沒有的功能一律關掉，編輯器裡就不會做出存不進去的內容
        code: false,
        codeBlock: false,
        blockquote: false,
        listItem: false,
        link: {
            openOnClick: false,
            autolink: false,
            isAllowedUri: (url) => Boolean(safeHref(url)),
        },
    }),
    ArticleBlockquote,
    ArticleListItem,
    TaskList,
    ArticleTaskItem,
    Table.configure({ resizable: false, HTMLAttributes: { class: 'rte-table' } }),
    TableRow,
    TableHeader.extend({ content: CELL_CONTENT, addAttributes: withoutAlign }),
    TableCell.extend({ content: CELL_CONTENT, addAttributes: withoutAlign }),
    TextAlign,
    TextColor,
    Highlight,
    FontSize,
    Subscript,
    Superscript,
    Callout,
    Youtube,
    ArticleImage,
];
