import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import PageSidebar from './PageSidebar';

/** FE-11：這支元件原本完全沒有測試，改用筆記 id 當選取依據時，
 * 漏改一處（分享按鈕的顯示條件仍讀舊的 prop 名稱）在建置與其他測試裡
 * 都不會被發現——那是 render 當下才會炸的 ReferenceError。這裡補上最基本
 * 的渲染與互動覆蓋，讓 prop 介面的改動至少有一道防線。 */

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

        expect(screen.getByLabelText('第 1 頁：第一篇')).toBeInTheDocument();
        expect(screen.getByLabelText('第 2 頁：（未命名）')).toBeInTheDocument();
    });

    test('目前這一頁有未儲存變更時，標籤加上星號', () => {
        renderSidebar({ currentPage: 1, isDirty: true });

        expect(screen.getByLabelText('第 2 頁：（未命名）*')).toBeInTheDocument();
    });

    test('勾選狀態依筆記 id 判斷，不是依頁次', () => {
        renderSidebar({ selectedPageIds: ['b'] });

        expect(screen.getByLabelText('第 1 頁：第一篇')).not.toBeChecked();
        expect(screen.getByLabelText('第 2 頁：（未命名）')).toBeChecked();
    });

    test('點選頁次時回報的是筆記 id', async () => {
        const user = userEvent.setup();
        const { props } = renderSidebar();

        await user.click(screen.getByLabelText('第 2 頁：（未命名）'));

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
        await user.tab(); // 取消 -> 下一個可聚焦元素（頁面勾選方塊 x2）-> 分享
        await user.tab(); await user.tab();
        expect(shareButton).toHaveFocus();
    });

    test('有選取時分享按鈕可用、沒有原因說明，點擊會送出', async () => {
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
