import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTimedOptionSelect } from './useTimedOptionSelect';

describe('useTimedOptionSelect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('beginSelection 設定 selected，delayMs 後呼叫 onElapsed 並清空 selected', () => {
    const onElapsed = vi.fn();
    const { result } = renderHook(() => useTimedOptionSelect({ delayMs: 1400, onElapsed }));

    act(() => {
      result.current.beginSelection('A');
    });
    expect(result.current.selected).toBe('A');
    expect(onElapsed).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(onElapsed).toHaveBeenCalledTimes(1);
    expect(result.current.selected).toBeNull();
  });

  test('同一個 tick 內連續呼叫兩次 beginSelection，只有第一次成功（回歸測試：原本只靠 selected state 擋，同一批次內兩次呼叫都讀到 null）', () => {
    const onElapsed = vi.fn();
    const { result } = renderHook(() => useTimedOptionSelect({ delayMs: 1400, onElapsed }));

    let firstResult, secondResult;
    act(() => {
      firstResult = result.current.beginSelection('A');
      secondResult = result.current.beginSelection('B');
    });

    expect(firstResult).toBe(true);
    expect(secondResult).toBe(false);
    expect(result.current.selected).toBe('A');

    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  test('resetSelection 會清掉還沒觸發的 timeout，之後不會再呼叫 onElapsed', () => {
    const onElapsed = vi.fn();
    const { result } = renderHook(() => useTimedOptionSelect({ delayMs: 1400, onElapsed }));

    act(() => {
      result.current.beginSelection('A');
    });
    act(() => {
      result.current.resetSelection();
    });
    expect(result.current.selected).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(onElapsed).not.toHaveBeenCalled();

    // reset 之後應該可以重新選擇
    let canSelectAgain;
    act(() => {
      canSelectAgain = result.current.beginSelection('C');
    });
    expect(canSelectAgain).toBe(true);
  });

  test('resetKey 改變時（例如切換到下一題／重新開始）自動清掉選取狀態跟待觸發的 timeout', () => {
    const onElapsed = vi.fn();
    const { result, rerender } = renderHook(
      ({ resetKey }) => useTimedOptionSelect({ delayMs: 1400, onElapsed, resetKey }),
      { initialProps: { resetKey: 'q1' } },
    );

    act(() => {
      result.current.beginSelection('A');
    });
    expect(result.current.selected).toBe('A');

    rerender({ resetKey: 'q2' });
    expect(result.current.selected).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(onElapsed).not.toHaveBeenCalled();
  });

  test('unmount 時會清掉還沒觸發的 timeout，不會在卸載後呼叫 onElapsed（回歸測試：原本 setTimeout 完全沒有清理）', () => {
    const onElapsed = vi.fn();
    const { result, unmount } = renderHook(() => useTimedOptionSelect({ delayMs: 1400, onElapsed }));

    act(() => {
      result.current.beginSelection('A');
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(onElapsed).not.toHaveBeenCalled();
  });

  test('onElapsed 換成新的 inline function 不會影響已經排定的 timeout（用 ref 存最新的 callback）', () => {
    const firstOnElapsed = vi.fn();
    const secondOnElapsed = vi.fn();
    const { result, rerender } = renderHook(
      ({ onElapsed }) => useTimedOptionSelect({ delayMs: 1400, onElapsed }),
      { initialProps: { onElapsed: firstOnElapsed } },
    );

    act(() => {
      result.current.beginSelection('A');
    });
    rerender({ onElapsed: secondOnElapsed });

    act(() => {
      vi.advanceTimersByTime(1400);
    });

    expect(secondOnElapsed).toHaveBeenCalledTimes(1);
    expect(firstOnElapsed).not.toHaveBeenCalled();
  });
});
