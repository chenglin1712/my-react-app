import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import PageSidebar from './PageSidebar';
import * as pagePreview from '../pagePreview';
import { mockViewport } from '../testDesktopMatchMedia';
mockViewport(true);   // 電腦版寬度：頁面清單直接顯示

/** FE-11：這支元件原本完全沒有測試，改用筆記 id 當選取依據時，
 * 漏改一處（分享按鈕的顯示條件仍讀舊的 prop 名稱）在建置與其他測試裡
 * 都不會被發現——那是 render 當下才會炸的 ReferenceError。這裡補上最基本
 * 的渲染與互動覆蓋，讓 prop 介面的改動至少有一道防線。 */

const previewSpy = vi.spyOn(pagePreview, 'previewText');

const NOTES = [
    { id: 'a', title: '第一篇', content: '<p>A</p>' },
    { id: 'b', title: '', content: '<p>B</p>' },
];

function renderSidebar(overrides = {}) {
    const props = {
        notes: NOTES,
        currentPage: 0,
        isDirty: false,
        selectedPageIds: [],
        onToggleSelect: vi.fn(),
        onSelectAll: vi.fn(),
        onClearSelect: vi.fn(),
        onShare: vi.fn(),
        ...overrides,
    };
    return { props, ...render(<PageSidebar {...props} />) };
}

describe('PageSidebar', () => {
    test('列出每一頁，未命名的顯示替代文字', () => {
        renderSidebar();

        expect(screen.getByLabelText('分享：第 1 頁：第一篇')).toBeInTheDocument();
        expect(screen.getByLabelText('分享：第 2 頁：（未命名）')).toBeInTheDocument();
    });

    test('目前這一頁有未儲存變更時，標籤加上星號', () => {
        renderSidebar({ currentPage: 1, isDirty: true });

        expect(screen.getByLabelText('分享：第 2 頁：（未命名）*')).toBeInTheDocument();
    });

    test('勾選狀態依筆記 id 判斷，不是依頁次', () => {
        renderSidebar({ selectedPageIds: ['b'] });

        expect(screen.getByLabelText('分享：第 1 頁：第一篇')).not.toBeChecked();
        expect(screen.getByLabelText('分享：第 2 頁：（未命名）')).toBeChecked();
    });

    test('點選頁次時回報的是筆記 id', async () => {
        const user = userEvent.setup();
        const { props } = renderSidebar();

        await user.click(screen.getByLabelText('分享：第 2 頁：（未命名）'));

        expect(props.onToggleSelect).toHaveBeenCalledWith('b');
    });

    test('D-5：沒有選取任何頁時分享按鈕仍然顯示，但不能送出，並說明原因', async () => {
        const user = userEvent.setup();
        const { props } = renderSidebar();
        const shareButton = screen.getByRole('button', { name: '分享' });

        expect(shareButton).toHaveAttribute('aria-disabled', 'true');
        expect(shareButton).toHaveAccessibleDescription('請先勾選上方要分享的頁面。');
        expect(screen.getByText('請先勾選上方要分享的頁面。')).toBeVisible();

        await user.click(shareButton);
        expect(props.onShare).not.toHaveBeenCalled();
    });

    test('D-5：沒勾選時的分享按鈕仍可被鍵盤聚焦（用 aria-disabled，不是 disabled）', async () => {
        const user = userEvent.setup();
        renderSidebar();
        const shareButton = screen.getByRole('button', { name: '分享' });
        expect(shareButton).not.toBeDisabled();
        await user.click(screen.getByRole('button', { name: '取消' }));
        await user.tab(); // 取消 -> 下一個可聚焦元素（每頁：勾選方框、切換頁面鈕，共 2 頁 4 個）-> 分享
        await user.tab(); await user.tab(); await user.tab(); await user.tab();
        expect(shareButton).toHaveFocus();
    });

    test('有選取時分享按鈕可用、沒有原因說明，點選會送出', async () => {
        const user = userEvent.setup();
        const { props } = renderSidebar({ selectedPageIds: ['a'] });
        const shareButton = screen.getByRole('button', { name: '分享' });

        expect(shareButton).not.toHaveAttribute('aria-disabled');
        expect(screen.queryByText('請先勾選上方要分享的頁面。')).not.toBeInTheDocument();

        await user.click(shareButton);
        expect(props.onShare).toHaveBeenCalledTimes(1);
    });

    test('分享中：按鈕停用並顯示「分享中…」', () => {
        renderSidebar({ selectedPageIds: ['a'], isSharing: true });
        expect(screen.getByRole('button', { name: '分享中…' })).toBeDisabled();
    });
});

describe('PageSidebar 卡片與預覽（Apple 化步驟 4-8）', () => {
    test('每頁是一張卡片，顯示內容純文字預覽，預覽用 aria-describedby 連回「切換頁面」按鈕', () => {
        const { container } = renderSidebar({ notes: [{ id: 'a', title: '第一篇', content: '<p>你好 <b>世界</b></p><script>x</script><img src="http://e.test/p.png">&amp;' }] });
        const card = container.querySelector('.note-page-card');
        expect(card).not.toBeNull();
        const preview = container.querySelector('.note-page-preview');
        expect(preview.textContent).toBe('你好 世界 &');
        expect(screen.getByRole('button', { name: /第 1 頁：第一篇/ })).toHaveAttribute('aria-describedby', preview.id);
        expect(container.querySelector('.note-page-preview b')).toBeNull();
    });

    test('沒有內容時不渲染預覽；目前這頁有「目前編輯」標籤；勾選的卡片有 is-selected', () => {
        const { container } = renderSidebar({ notes: [{ id: 'a', title: 'A', content: '' }, { id: 'b', title: 'B', content: '<p>b</p>' }], currentPage: 1, selectedPageIds: ['a'] });
        const cards = container.querySelectorAll('.note-page-card');
        expect(cards[0].querySelector('.note-page-preview')).toBeNull();
        expect(cards[0]).toHaveClass('is-selected');
        expect(cards[1]).toHaveClass('is-current');
        expect(cards[1]).toHaveTextContent('目前編輯');
        expect(cards[0]).not.toHaveTextContent('目前編輯');
    });
});

describe('PageSidebar 左側頁面縮圖列（P5-3）', () => {
    test('點卡片切換頁面（回報頁次），不會順便勾選要分享的頁面', async () => {
        const user = userEvent.setup();
        const { props } = renderSidebar({ onSelectPage: vi.fn() });
        await user.click(screen.getByRole('button', { name: /第 2 頁：（未命名）/ }));
        expect(props.onSelectPage).toHaveBeenCalledWith(1);
        expect(props.onToggleSelect).not.toHaveBeenCalled();
    });

    test('目前這一頁標 aria-current="page" 與「目前編輯」；其他頁沒有', () => {
        renderSidebar({ currentPage: 1 });
        expect(screen.getByRole('button', { name: /第 2 頁/ })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: /第 1 頁/ })).not.toHaveAttribute('aria-current');
    });

    test('手機寬度的「頁面」按鈕顯示目前第幾頁／共幾頁，並標示會開啟對話框', () => {
        renderSidebar({ currentPage: 1 });
        const toggle = screen.getByRole('button', { name: '頁面（第 2 / 2 頁）' });
        expect(toggle).toHaveAttribute('aria-haspopup', 'dialog');
    });

    test('200 頁：全部渲染得出來；改其中一頁的內容，只有那一頁的預覽會重算（其餘卡片 memo）', () => {
        const notes = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, title: `第${i}篇`, content: `<p>內容${i}</p>` }));
        const props = { notes, currentPage: 0, isDirty: false, selectedPageIds: [], maxSelectable: 50, onToggleSelect: vi.fn(), onSelectAll: vi.fn(), onClearSelect: vi.fn(), onShare: vi.fn(), onSelectPage: vi.fn() };
        const { container, rerender } = render(<PageSidebar {...props} />);
        expect(container.querySelectorAll('.note-page-card')).toHaveLength(200);
        previewSpy.mockClear();
        const edited = notes.map((n, i) => (i === 0 ? { ...n, content: '<p>改過了</p>' } : n));
        rerender(<PageSidebar {...props} notes={edited} />);
        expect(previewSpy).toHaveBeenCalledTimes(1);
        expect(container.querySelector('.note-page-preview').textContent).toBe('改過了');
    });
});
