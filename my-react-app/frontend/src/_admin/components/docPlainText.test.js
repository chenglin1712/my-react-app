import { describe, expect, test } from 'vitest';
import { docToPlainText } from './docPlainText';

describe('docToPlainText（WP-8 追加）', () => {
    test('區塊之間換行、行內文字串接、圖片與影片以占位文字標示', () => {
        const doc = {
            type: 'doc',
            content: [
                { type: 'heading', content: [{ type: 'text', text: '標題' }] },
                { type: 'paragraph', content: [{ type: 'text', text: '第一句，' }, { type: 'text', text: '第二句' }] },
                { type: 'image', attrs: { src: 'https://example.com/a.png', alt: '示意圖' } },
                {
                    type: 'bulletList',
                    content: [
                        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲' }] }] },
                        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '乙' }] }] },
                    ],
                },
                { type: 'youtube', attrs: { videoId: 'abcdefghijk' } },
            ],
        };
        const text = docToPlainText(doc);
        expect(text).toContain('標題\n第一句，第二句');
        expect(text).toContain('[圖片：示意圖]');
        expect(text).toContain('[影片]');
        expect(text.indexOf('甲')).toBeLessThan(text.indexOf('乙'));
    });

    const p = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
    const li = (...content) => ({ type: 'listItem', content });

    test('WP-8 追加：無序清單加「・」、有序清單依 start 編號、待辦清單標示勾選', () => {
        const doc = {
            type: 'doc',
            content: [
                { type: 'bulletList', content: [li(p('甲')), li(p('乙'))] },
                { type: 'orderedList', attrs: { start: 3 }, content: [li(p('第三')), li(p('第四'))] },
                { type: 'orderedList', content: [li(p('一'))] },
                {
                    type: 'taskList',
                    content: [
                        { type: 'taskItem', attrs: { checked: true }, content: [p('做完')] },
                        { type: 'taskItem', attrs: { checked: false }, content: [p('還沒')] },
                    ],
                },
            ],
        };
        expect(docToPlainText(doc)).toBe('・ 甲\n・ 乙\n3. 第三\n4. 第四\n1. 一\n[x] 做完\n[ ] 還沒');
    });

    test('WP-8 追加：巢狀清單縮排；同一項的第二段與段內換行對齊縮排；空項目仍保留符號', () => {
        const doc = {
            type: 'doc',
            content: [{
                type: 'orderedList',
                content: [
                    li(
                        { type: 'paragraph', content: [{ type: 'text', text: '第一行' }, { type: 'hardBreak' }, { type: 'text', text: '換行' }] },
                        p('第二段'),
                        { type: 'bulletList', content: [li(p('子項 A')), li(p('子項 B'))] },
                    ),
                    li(p('')),
                    li(p('最後')),
                ],
            }],
        };
        expect(docToPlainText(doc)).toBe('1. 第一行\n  換行\n  第二段\n  ・ 子項 A\n  ・ 子項 B\n2.\n3. 最後');
    });

    test('WP-8 追加：表格一列一行、儲存格以「 | 」分隔，儲存格內的多段落壓成一行', () => {
        const cell = (type, ...paragraphs) => ({ type, content: paragraphs.map(p) });
        const doc = {
            type: 'doc',
            content: [
                p('表格前'),
                {
                    type: 'table',
                    content: [
                        { type: 'tableRow', content: [cell('tableHeader', '族語'), cell('tableHeader', '中文')] },
                        { type: 'tableRow', content: [cell('tableCell', 'lokah'), cell('tableCell', '你好', '（問候）')] },
                        { type: 'tableRow', content: [cell('tableCell', ''), cell('tableCell', '空白格')] },
                    ],
                },
                p('表格後'),
            ],
        };
        expect(docToPlainText(doc)).toBe('表格前\n族語 | 中文\nlokah | 你好 （問候）\n | 空白格\n表格後');
    });

    test('非文件或空文件回空字串', () => {
        expect(docToPlainText(null)).toBe('');
        expect(docToPlainText({})).toBe('');
        expect(docToPlainText({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe('');
    });
});
