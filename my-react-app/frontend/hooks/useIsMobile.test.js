import { describe, test, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useIsMobile } from './useIsMobile';

function setWindowWidth(width) {
  window.innerWidth = width;
  window.dispatchEvent(new Event('resize'));
}

describe('useIsMobile', () => {
  const originalWidth = window.innerWidth;

  afterEach(() => {
    window.innerWidth = originalWidth;
  });

  test('掛載當下就用目前的 window.innerWidth 判斷，不會先閃一次錯的值', () => {
    window.innerWidth = 500;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  test('resize 時會更新', () => {
    window.innerWidth = 1200;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => { setWindowWidth(500); });
    expect(result.current).toBe(true);
  });

  test('unmount 後會移除 resize 監聽', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useIsMobile());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    removeSpy.mockRestore();
  });
});
