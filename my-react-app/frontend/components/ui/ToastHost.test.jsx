import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ToastHost from './ToastHost';
import { showToast, resetToasts, MAX_TOASTS } from '@utils/toast';

beforeEach(() => {
  vi.useFakeTimers();
  window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { act(() => resetToasts()); vi.useRealTimers(); });

describe('ToastHost（P1-6）', () => {
  test('外層是 role=status；顯示訊息，4 秒後自動消失', () => {
    render(<ToastHost />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => { showToast({ message: '已加入收藏' }); });
    expect(screen.getByText('已加入收藏')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(4000 + 200); });
    expect(screen.queryByText('已加入收藏')).toBeNull();
  });

  test('復原按鈕會呼叫 onAction 並關閉', () => {
    const undo = vi.fn();
    render(<ToastHost />);
    act(() => { showToast({ message: '已刪除', actionLabel: '復原', onAction: undo }); });
    fireEvent.click(screen.getByRole('button', { name: '復原' }));
    expect(undo).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.queryByText('已刪除')).toBeNull();
  });

  test('滑鼠停留時暫停計時，移開後才繼續', () => {
    render(<ToastHost />);
    act(() => { showToast({ message: '停留測試' }); });
    const box = screen.getByText('停留測試').parentElement;
    fireEvent.mouseEnter(box);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(screen.getByText('停留測試')).toBeInTheDocument();
    fireEvent.mouseLeave(box);
    act(() => { vi.advanceTimersByTime(4000 + 200); });
    expect(screen.queryByText('停留測試')).toBeNull();
  });

  test('鍵盤焦點在裡面時也暫停', () => {
    render(<ToastHost />);
    act(() => { showToast({ message: '焦點測試', actionLabel: '復原', onAction() {} }); });
    fireEvent.focus(screen.getByRole('button', { name: '復原' }));
    act(() => { vi.advanceTimersByTime(10000); });
    expect(screen.getByText('焦點測試')).toBeInTheDocument();
  });

  test('最多同時 3 則，最舊的被擠掉', () => {
    render(<ToastHost />);
    act(() => { for (let i = 1; i <= MAX_TOASTS + 2; i += 1) showToast({ message: `訊息${i}` }); });
    expect(screen.queryByText('訊息1')).toBeNull();
    expect(screen.queryByText('訊息2')).toBeNull();
    expect(screen.getByText('訊息5')).toBeInTheDocument();
    expect(document.querySelectorAll('.yy-toast')).toHaveLength(MAX_TOASTS);
  });
});
