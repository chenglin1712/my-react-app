import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Trash2, Edit3 } from 'lucide-react';

import AdminRowMenu from './AdminRowMenu';

const setup = (props = {}) => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
        <MemoryRouter>
            <button>列外的按鈕</button>
            <AdminRowMenu
                label="「測試公告」的更多操作"
                items={[
                    { key: 'edit', label: '編輯', icon: Edit3, onSelect: onEdit },
                    { key: 'view', label: '檢視', href: '/admin/content/announcements/1' },
                    { key: 'delete', label: '刪除', icon: Trash2, danger: true, onSelect: onDelete },
                ]}
                {...props}
            />
        </MemoryRouter>,
    );
    return { onEdit, onDelete, toggle: screen.getByRole('button', { name: '「測試公告」的更多操作' }) };
};

describe('AdminRowMenu（⋯ 更多操作）', () => {
    test('按鈕有說明是哪一筆的名稱與 aria 狀態，開啟後出現 menu 與 menuitem', async () => {
        const { toggle } = setup();
        expect(toggle).toHaveAttribute('aria-haspopup', 'menu');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();

        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('menu', { name: '「測試公告」的更多操作' })).toBeInTheDocument();
        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['編輯', '檢視', '刪除']);
    });

    test('開啟後焦點移到第一項；方向鍵、Home、End 在項目間移動', async () => {
        const user = userEvent.setup();
        const { toggle } = setup();
        fireEvent.click(toggle);
        const [edit, view, remove] = screen.getAllByRole('menuitem');
        await waitFor(() => expect(edit).toHaveFocus());

        await user.keyboard('{ArrowDown}');
        expect(view).toHaveFocus();
        await user.keyboard('{End}');
        expect(remove).toHaveFocus();
        await user.keyboard('{ArrowDown}');
        expect(edit).toHaveFocus(); // 循環
        await user.keyboard('{ArrowUp}');
        expect(remove).toHaveFocus();
        await user.keyboard('{Home}');
        expect(edit).toHaveFocus();
    });

    test('Escape 關閉選單並把焦點還給「⋯」按鈕', async () => {
        const user = userEvent.setup();
        const { toggle } = setup();
        fireEvent.click(toggle);
        await waitFor(() => expect(screen.getAllByRole('menuitem')[0]).toHaveFocus());

        await user.keyboard('{Escape}');
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(toggle).toHaveFocus();
    });

    test('Tab 關閉選單並回到按鈕，不會把焦點帶到選單外的其他位置', async () => {
        const user = userEvent.setup();
        const { toggle } = setup();
        fireEvent.click(toggle);
        await waitFor(() => expect(screen.getAllByRole('menuitem')[0]).toHaveFocus());

        await user.tab();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(toggle).toHaveFocus();
    });

    test('選取項目會關閉選單、還原焦點並呼叫 onSelect', async () => {
        const { toggle, onDelete } = setup();
        fireEvent.click(toggle);
        fireEvent.click(screen.getByRole('menuitem', { name: '刪除' }));
        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(toggle).toHaveFocus();
    });

    test('有 href 的項目是真正的連結（可以在新分頁開啟）', () => {
        const { toggle } = setup();
        fireEvent.click(toggle);
        expect(screen.getByRole('menuitem', { name: '檢視' })).toHaveAttribute('href', '/admin/content/announcements/1');
    });

    test('刪除是 danger 項目：上方有分隔線，且排在最後', () => {
        const { toggle } = setup();
        fireEvent.click(toggle);
        const separator = screen.getByRole('separator');
        expect(separator).toBeInTheDocument();
        const remove = screen.getByRole('menuitem', { name: '刪除' });
        expect(remove).toHaveClass('is-danger');
        // 分隔線在「檢視」與「刪除」之間
        expect(separator.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    test('disabled 的項目不會觸發 onSelect，並標示 aria-disabled', () => {
        const onSelect = vi.fn();
        render(
            <MemoryRouter>
                <AdminRowMenu label="操作" items={[{ key: 'x', label: '不能按', onSelect, disabled: true }]} />
            </MemoryRouter>,
        );
        fireEvent.click(screen.getByRole('button', { name: '操作' }));
        const item = screen.getByRole('menuitem', { name: '不能按' });
        expect(item).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(item);
        expect(onSelect).not.toHaveBeenCalled();
    });

    test('整列忙碌（disabled）時按鈕停用，已開啟的選單也會收起', () => {
        const items = [{ key: 'x', label: '動作' }];
        const { rerender } = render(<MemoryRouter><AdminRowMenu label="操作" items={items} /></MemoryRouter>);
        fireEvent.click(screen.getByRole('button', { name: '操作' }));
        expect(screen.getByRole('menu')).toBeInTheDocument();
        rerender(<MemoryRouter><AdminRowMenu label="操作" items={items} disabled /></MemoryRouter>);
        expect(screen.getByRole('button', { name: '操作' })).toBeDisabled();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
});
