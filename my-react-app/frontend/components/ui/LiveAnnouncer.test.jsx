import { describe, expect, test, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import LiveAnnouncer from './LiveAnnouncer';
import { announce } from '@utils/announce';

afterEach(() => vi.useRealTimers());

describe('LiveAnnouncer', () => {
  test('常駐兩個隱藏的 live region：polite（status）與 assertive，且不佔用 alert 角色', () => {
    render(<LiveAnnouncer />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('live-assertive')).toHaveAttribute('aria-live', 'assertive');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('50ms 內先後公告 polite 與 assertive，兩則都會留下', () => {
    vi.useFakeTimers();
    render(<LiveAnnouncer />);
    act(() => { announce('已加入收藏'); announce('收藏失敗', { assertive: true }); vi.advanceTimersByTime(60); });
    expect(screen.getByRole('status')).toHaveTextContent('已加入收藏');
    expect(screen.getByTestId('live-assertive')).toHaveTextContent('收藏失敗');
  });

  test('announce() 的訊息會依急迫程度出現在對應的 region', () => {
    vi.useFakeTimers();
    render(<LiveAnnouncer />);
    act(() => { announce('已加入收藏'); vi.advanceTimersByTime(60); });
    expect(screen.getByRole('status')).toHaveTextContent('已加入收藏');
    act(() => { announce('收藏失敗', { assertive: true }); vi.advanceTimersByTime(60); });
    expect(screen.getByTestId('live-assertive')).toHaveTextContent('收藏失敗');
  });

  test('連續兩次相同訊息也會重新公告（先清空再填入）', () => {
    vi.useFakeTimers();
    render(<LiveAnnouncer />);
    act(() => { announce('已加入收藏'); vi.advanceTimersByTime(60); });
    act(() => { announce('已加入收藏'); });
    expect(screen.getByRole('status')).toHaveTextContent('');
    act(() => { vi.advanceTimersByTime(60); });
    expect(screen.getByRole('status')).toHaveTextContent('已加入收藏');
  });
});
