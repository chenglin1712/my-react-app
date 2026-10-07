import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import AdminEntryGate from './AdminEntryGate';
import { useAdminEntry } from './adminEntryContext';

// 模擬 AdminLayout：掛載後通知閘門「殼層準備好了」，並把 revealed 狀態顯示出來
const Shell = () => {
    const { markReady, revealed, firstEntry } = useAdminEntry();
    useEffect(() => { markReady(); }, [markReady]);
    return <div data-testid="shell" data-first={String(firstEntry)} data-revealed={String(revealed)} />;
};

const overlay = (container) => container.querySelector('.admin-entry');

describe('AdminEntryGate（入口儀式）', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        window.sessionStorage.clear();
    });
    afterEach(() => {
        vi.useRealTimers();
        window.sessionStorage.clear();
    });

    test('第一次進入：先蓋著載入畫面，至少 800ms 後才開始收合，收合完才移除', () => {
        const { container, getByTestId } = render(<AdminEntryGate><Shell /></AdminEntryGate>);
        expect(overlay(container)).not.toBeNull();
        expect(overlay(container)).not.toHaveClass('is-leaving');
        expect(getByTestId('shell').dataset.revealed).toBe('false');

        act(() => { vi.advanceTimersByTime(700); });
        expect(overlay(container)).not.toHaveClass('is-leaving');   // 還沒到最短可見時間

        act(() => { vi.advanceTimersByTime(150); });
        expect(overlay(container)).toHaveClass('is-leaving');        // 開始收合，殼層同時開始進場
        expect(getByTestId('shell').dataset.revealed).toBe('true');

        act(() => { vi.advanceTimersByTime(700); });
        expect(overlay(container)).toBeNull();
    });

    test('走完之後同一分頁不再播（重新整理、再進後台都直接顯示）', () => {
        const first = render(<AdminEntryGate><Shell /></AdminEntryGate>);
        act(() => { vi.advanceTimersByTime(850); });   // 開始收合
        act(() => { vi.advanceTimersByTime(700); });   // 收合結束，寫入「已進入過」
        first.unmount();

        const { container, getByTestId } = render(<AdminEntryGate><Shell /></AdminEntryGate>);
        expect(overlay(container)).toBeNull();
        expect(getByTestId('shell').dataset.first).toBe('false');
    });

    test('殼層一直沒準備好（例如還在載入）就一直保持載入畫面，不會自己收合', () => {
        const Never = () => <div />;
        const { container } = render(<AdminEntryGate><Never /></AdminEntryGate>);
        act(() => { vi.advanceTimersByTime(10000); });
        expect(overlay(container)).not.toBeNull();
        expect(overlay(container)).not.toHaveClass('is-leaving');
    });

    test('要求降低動態時只保留極短的過場', () => {
        window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
        const { container } = render(<AdminEntryGate><Shell /></AdminEntryGate>);
        act(() => { vi.advanceTimersByTime(300); });
        expect(overlay(container)).toHaveClass('is-leaving');
        delete window.matchMedia;
    });
});
