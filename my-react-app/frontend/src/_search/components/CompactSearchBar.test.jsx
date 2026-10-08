import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CompactSearchBar from './CompactSearchBar';

const setup = (overrides = {}) => {
    const props = {
        query: '', setQuery: vi.fn(), handleSearch: vi.fn(), loading: false,
        tribeLabel: '泰雅族語', visible: true, offset: 90, ...overrides,
    };
    const utils = render(<CompactSearchBar {...props} />);
    return { ...utils, props };
};

describe('CompactSearchBar（捲出頁首後的精簡搜尋列）', () => {
    test('顯示目前的族語，輸入會更新共用的 query', () => {
        const { props } = setup();
        expect(screen.getByText('泰雅族語')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('快速查詢關鍵字'), { target: { value: 'abas' } });
        expect(props.setQuery).toHaveBeenCalledWith('abas');
    });

    test('按 Enter 與按 GO 都會搜尋；輸入法組字中的 Enter 不算', () => {
        const { props } = setup({ query: 'abas' });
        const input = screen.getByLabelText('快速查詢關鍵字');
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(props.handleSearch).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
        expect(props.handleSearch).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'GO 搜尋' }));
        expect(props.handleSearch).toHaveBeenCalledTimes(2);
    });

    test('載入中時 GO 停用，避免重複送出', () => {
        setup({ loading: true });
        expect(screen.getByRole('button', { name: 'GO 搜尋' })).toBeDisabled();
    });

    test('看不到時（頁首還在畫面內）整條列對鍵盤與讀屏隱藏，不佔位置', () => {
        const { container } = setup({ visible: false });
        const bar = container.querySelector('.search-compact-bar');
        expect(bar).not.toHaveClass('is-visible');
        expect(bar).toHaveAttribute('inert');
    });

    test('「↑ 篩選」捲回頁首', () => {
        window.scrollTo = vi.fn();
        setup();
        fireEvent.click(screen.getByRole('button', { name: '回到頁首修改篩選與分類' }));
        expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    });
});
