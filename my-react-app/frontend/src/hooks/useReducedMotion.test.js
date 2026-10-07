import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { prefersReducedMotion, scrollBehavior, useReducedMotion } from './useReducedMotion';

const mockMatchMedia = (matches) => {
    const listeners = new Set();
    const media = {
        matches,
        addEventListener: (_type, fn) => listeners.add(fn),
        removeEventListener: (_type, fn) => listeners.delete(fn),
    };
    window.matchMedia = vi.fn(() => media);
    return {
        change: (next) => {
            media.matches = next;
            listeners.forEach((fn) => fn({ matches: next }));
        },
    };
};

afterEach(() => {
    delete window.matchMedia;
});

describe('降低動態偏好', () => {
    test('沒有 matchMedia 的環境視為不降低動態', () => {
        expect(prefersReducedMotion()).toBe(false);
        expect(scrollBehavior()).toBe('smooth');
    });

    test('要求降低動態時，捲動改為直接跳到位置', () => {
        mockMatchMedia(true);
        expect(prefersReducedMotion()).toBe(true);
        expect(scrollBehavior()).toBe('auto');
    });

    test('hook 會跟著偏好在使用中改變', () => {
        const media = mockMatchMedia(false);
        const { result } = renderHook(() => useReducedMotion());
        expect(result.current).toBe(false);
        act(() => media.change(true));
        expect(result.current).toBe(true);
    });
});
