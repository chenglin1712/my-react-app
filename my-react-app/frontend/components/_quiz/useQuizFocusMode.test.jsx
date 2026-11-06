import { StrictMode } from 'react';
import { describe, test, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useQuizFocusMode, QUIZ_FOCUS_ATTR } from './useQuizFocusMode';

describe('useQuizFocusMode（Apple 化步驟 4-6a）', () => {
  test('掛載時在 <html> 掛上 data-quiz-focus，卸載時一定移除（不然別頁會沒有導覽）', () => {
    expect(document.documentElement).not.toHaveAttribute(QUIZ_FOCUS_ATTR);
    const { unmount } = renderHook(() => useQuizFocusMode());
    expect(document.documentElement).toHaveAttribute(QUIZ_FOCUS_ATTR, 'true');
    unmount();
    expect(document.documentElement).not.toHaveAttribute(QUIZ_FOCUS_ATTR);
  });

  test('enabled 為 false 時不掛；由 true 變 false 時移除', () => {
    const { rerender } = renderHook(({ on }) => useQuizFocusMode(on), { initialProps: { on: false } });
    expect(document.documentElement).not.toHaveAttribute(QUIZ_FOCUS_ATTR);
    rerender({ on: true });
    expect(document.documentElement).toHaveAttribute(QUIZ_FOCUS_ATTR);
    rerender({ on: false });
    expect(document.documentElement).not.toHaveAttribute(QUIZ_FOCUS_ATTR);
  });
});

describe('useQuizFocusMode 的擁有權（審查補強）', () => {
  test('兩個地方同時要求：先卸載一個，另一個還在就不能移除；最後一個離開才移除', () => {
    const a = renderHook(() => useQuizFocusMode());
    const b = renderHook(() => useQuizFocusMode());
    a.unmount();
    expect(document.documentElement).toHaveAttribute(QUIZ_FOCUS_ATTR, 'true');
    b.unmount();
    expect(document.documentElement).not.toHaveAttribute(QUIZ_FOCUS_ATTR);
  });

  test('StrictMode 的 setup→cleanup→setup 不會留下或誤刪屬性', () => {
    const { unmount } = renderHook(() => useQuizFocusMode(), { wrapper: StrictMode });
    expect(document.documentElement).toHaveAttribute(QUIZ_FOCUS_ATTR, 'true');
    unmount();
    expect(document.documentElement).not.toHaveAttribute(QUIZ_FOCUS_ATTR);
  });
});
