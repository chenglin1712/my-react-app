import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SkeletonBlocks, DelayedSkeleton, ErrorState } from './StateViews';

afterEach(() => { vi.useRealTimers(); });

describe('SkeletonBlocks', () => {
  test('一個 status 區域加一句看不見的說明，佔位塊不給報讀器，高度依 rows', () => {
    const { container } = render(<SkeletonBlocks label="清單載入中…" rows={[40, '3rem']} />);
    expect(screen.getByRole('status')).toHaveTextContent('清單載入中…');
    const blocks = container.querySelectorAll('.yy-skeleton');
    expect(blocks).toHaveLength(2);
    blocks.forEach((b) => expect(b).toHaveAttribute('aria-hidden', 'true'));
    expect(blocks[0].style.height).toBe('40px');
    expect(blocks[1].style.height).toBe('3rem');
  });
});

describe('DelayedSkeleton', () => {
  test('1 秒內不畫骨架，超過才出現（避免快速載入時閃爍）', () => {
    vi.useFakeTimers();
    const { container } = render(<DelayedSkeleton label="頁面載入中…" />);
    // 等待期間沒有骨架塊，但有隱藏的 status 說明，報讀器立刻有回饋
    expect(container.querySelector('.yy-skeleton')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('頁面載入中…');
    act(() => { vi.advanceTimersByTime(999); });
    expect(container.querySelector('.yy-skeleton')).toBeNull();
    act(() => { vi.advanceTimersByTime(2); });
    expect(container.querySelectorAll('.yy-skeleton').length).toBeGreaterThan(0);
    expect(screen.getByRole('status')).toHaveTextContent('頁面載入中…');
  });

  test('在延遲內卸載不會留下計時器', () => {
    vi.useFakeTimers();
    const { unmount } = render(<DelayedSkeleton />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('ErrorState', () => {
  test('role=alert 說明錯誤，按重試鈕呼叫 onRetry', () => {
    const onRetry = vi.fn();
    render(<ErrorState title="載入失敗" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('載入失敗');
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('沒有 onRetry 就不放按鈕；可換重試文字與附加 class', () => {
    const { rerender, container } = render(<ErrorState title="x" />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<ErrorState title="x" onRetry={() => {}} retryLabel="再試一次" className="a" buttonClassName="b" />);
    expect(screen.getByRole('button', { name: '再試一次' })).toHaveClass('yy-state__btn', 'b');
    expect(container.firstChild).toHaveClass('yy-state', 'a');
  });
});
