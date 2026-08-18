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

    test('沒有選取任何頁時不顯示分享按鈕，有選取時才出現', async () => {
        const { unmount } = renderSidebar();
        expect(screen.queryByRole('button', { name: '分享' })).not.toBeInTheDocument();
        unmount();

        const user = userEvent.setup();
        const { props } = renderSidebar({ selectedPageIds: ['a'] });
        const shareButton = screen.getByRole('button', { name: '分享' });
        expect(shareButton).toBeInTheDocument();

        await user.click(shareButton);
        expect(props.onShare).toHaveBeenCalled();
    });
});
