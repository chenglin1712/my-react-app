import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useToast } from './useToast';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useToast', () => {
  test('顯示後到期隱藏，但文字保留到下一則（退場淡出時字不會先消失）', () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.showToast('已儲存', 1000));
    expect(result.current.toast).toEqual({ show: true, text: '已儲存' });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.toast).toEqual({ show: false, text: '已儲存' });
  });

  test('可被打斷：顯示中又來新訊息，立刻換字並重新計時，舊訊息的計時器不會提早把它關掉', () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.showToast('第一則', 1000));
    act(() => { vi.advanceTimersByTime(800); });
    act(() => result.current.showToast('第二則', 1000));
    expect(result.current.toast).toEqual({ show: true, text: '第二則' });
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current.toast.show).toBe(true);
    act(() => { vi.advanceTimersByTime(700); });
    expect(result.current.toast).toEqual({ show: false, text: '第二則' });
  });

  test('退場中又來新訊息會回到顯示', () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.showToast('甲', 500));
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current.toast.show).toBe(false);
    act(() => result.current.showToast('乙', 500));
    expect(result.current.toast).toEqual({ show: true, text: '乙' });
  });

  test('卸載時清掉計時器', () => {
    const { result, unmount } = renderHook(() => useToast());
    act(() => result.current.showToast('甲', 1000));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
