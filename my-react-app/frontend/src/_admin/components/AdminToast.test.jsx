import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AdminToastProvider, SuccessNotice, useAdminToast, TOAST_MS, MAX_TOASTS } from './AdminToast';

const Pusher = ({ texts }) => {
    const toast = useAdminToast();
    return <button type="button" onClick={() => texts.forEach((t) => toast.push(t))}>跳</button>;
};

describe('AdminToast', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    test('push 之後出現 role=status 的提示，5 秒後自己消失', () => {
        render(<AdminToastProvider><Pusher texts={['已儲存']} /></AdminToastProvider>);
        fireEvent.click(screen.getByRole('button', { name: '跳' }));
        expect(screen.getByRole('status')).toHaveTextContent('已儲存');
        act(() => { vi.advanceTimersByTime(TOAST_MS - 1); });
        expect(screen.queryByRole('status')).not.toBeNull();
        act(() => { vi.advanceTimersByTime(2); });
        expect(screen.queryByRole('status')).toBeNull();
    });

    test('空白文字不會跳出空提示', () => {
        render(<AdminToastProvider><Pusher texts={['', '   ', null]} /></AdminToastProvider>);
        fireEvent.click(screen.getByRole('button', { name: '跳' }));
        expect(screen.queryByRole('status')).toBeNull();
    });

    test(`同時最多 ${MAX_TOASTS} 張，超過時最舊的先被收掉`, () => {
        render(<AdminToastProvider><Pusher texts={['一', '二', '三', '四']} /></AdminToastProvider>);
        fireEvent.click(screen.getByRole('button', { name: '跳' }));
        const shown = screen.getAllByRole('status').map((el) => el.textContent);
        expect(shown).toHaveLength(MAX_TOASTS);
        expect(shown.join('')).toContain('四');
        expect(shown.join('')).not.toContain('一');
    });

    test('游標停在上面時暫停倒數，移開後重新計時', () => {
        render(<AdminToastProvider><Pusher texts={['已儲存']} /></AdminToastProvider>);
        fireEvent.click(screen.getByRole('button', { name: '跳' }));
        const toast = screen.getByRole('status');
        fireEvent.mouseEnter(toast);
        act(() => { vi.advanceTimersByTime(TOAST_MS * 3); });
        expect(screen.queryByRole('status')).not.toBeNull();
        fireEvent.mouseLeave(toast);
        act(() => { vi.advanceTimersByTime(TOAST_MS + 1); });
        expect(screen.queryByRole('status')).toBeNull();
    });

    test('關閉鈕有名稱，按了立刻收掉', () => {
        render(<AdminToastProvider><Pusher texts={['已儲存']} /></AdminToastProvider>);
        fireEvent.click(screen.getByRole('button', { name: '跳' }));
        fireEvent.click(screen.getByRole('button', { name: '關閉通知' }));
        expect(screen.queryByRole('status')).toBeNull();
    });

    test('SuccessNotice：有 Provider 時改跳 toast，頁面上不留行內提示', () => {
        const { container } = render(<AdminToastProvider><div id="page"><SuccessNotice message="首頁已儲存" /></div></AdminToastProvider>);
        expect(screen.getByRole('status')).toHaveTextContent('首頁已儲存');
        expect(container.querySelector('#page .alert')).toBeNull();
    });

    test('SuccessNotice：沒有 Provider 時退回行內 Alert；沒有訊息什麼都不輸出', () => {
        const a = render(<SuccessNotice message="已儲存" />);
        expect(screen.getByText('已儲存')).toHaveClass('alert-success');
        a.unmount();
        const { container } = render(<SuccessNotice message="" />);
        expect(container).toBeEmptyDOMElement();
    });

    test('SuccessNotice 在 StrictMode（effect 跑兩次）下只跳一張；清空後同一段文字可以再跳', () => {
        const { rerender } = render(<StrictMode><AdminToastProvider><SuccessNotice message="已儲存" /></AdminToastProvider></StrictMode>);
        expect(screen.getAllByRole('status')).toHaveLength(1);
        rerender(<StrictMode><AdminToastProvider><SuccessNotice message="" /></AdminToastProvider></StrictMode>);
        rerender(<StrictMode><AdminToastProvider><SuccessNotice message="已儲存" /></AdminToastProvider></StrictMode>);
        expect(screen.getAllByRole('status')).toHaveLength(2);
    });
});
