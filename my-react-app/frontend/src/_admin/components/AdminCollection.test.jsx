import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AdminFilterChips from './AdminFilterChips';
import AdminBulkBar from './AdminBulkBar';

describe('AdminFilterChips', () => {
    test('沒有條件時什麼都不輸出', () => {
        const { container } = render(<AdminFilterChips filters={[]} />);
        expect(container).toBeEmptyDOMElement();
    });

    test('一個條件一顆 chip，移除鈕的名稱帶完整條件；只有一個條件時沒有「清除全部」', () => {
        const onClear = vi.fn();
        render(<AdminFilterChips filters={[{ key: 'status', label: '狀態', value: '已發布', onClear }]} onClearAll={vi.fn()} />);
        expect(screen.getByRole('group', { name: '目前套用的篩選' })).toHaveTextContent('狀態已發布');
        fireEvent.click(screen.getByRole('button', { name: '移除篩選：狀態 已發布' }));
        expect(onClear).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: '清除全部' })).toBeNull();
    });

    test('兩個以上條件才出現「清除全部」', () => {
        const onClearAll = vi.fn();
        render(<AdminFilterChips
            filters={[
                { key: 'a', label: '狀態', value: '草稿', onClear: vi.fn() },
                { key: 'b', label: '族語', value: '阿美語', onClear: vi.fn() },
            ]}
            onClearAll={onClearAll}
        />);
        fireEvent.click(screen.getByRole('button', { name: '清除全部' }));
        expect(onClearAll).toHaveBeenCalledTimes(1);
    });
});

describe('AdminBulkBar', () => {
    test('沒有選取時不輸出；有選取時顯示數量（aria-live）與動作，取消選取可用', () => {
        const a = render(<AdminBulkBar count={0} />);
        expect(a.container).toBeEmptyDOMElement();
        a.unmount();

        const onClear = vi.fn();
        render(<AdminBulkBar count={3} noun="篇" onClear={onClear}><button type="button">批次下架</button></AdminBulkBar>);
        const region = screen.getByRole('region', { name: '批次操作' });
        expect(region).toHaveTextContent('已選 3 篇');
        expect(region.querySelector('[aria-live="polite"]')).not.toBeNull();
        expect(screen.getByRole('button', { name: '批次下架' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '取消選取' }));
        expect(onClear).toHaveBeenCalledTimes(1);
    });
});
