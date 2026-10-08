import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import OfflineBanner from './OfflineBanner';

const setOnline = (value) => vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);

afterEach(() => vi.restoreAllMocks());

describe('離線提示', () => {
    test('在線上時不顯示', () => {
        setOnline(true);
        render(<OfflineBanner />);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    test('開頁時就是離線會顯示提示', () => {
        setOnline(false);
        render(<OfflineBanner />);
        expect(screen.getByRole('status')).toHaveTextContent('目前沒有網路連線');
    });

    test('斷線時出現、恢復連線後消失', () => {
        setOnline(true);
        render(<OfflineBanner />);
        act(() => { window.dispatchEvent(new Event('offline')); });
        expect(screen.getByRole('status')).toBeInTheDocument();
        act(() => { window.dispatchEvent(new Event('online')); });
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
});
