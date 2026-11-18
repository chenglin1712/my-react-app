import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePullToRefresh, PULL_LIMIT } from './usePullToRefresh';

// jsdom 沒有觸控事件的建構子：用一般 Event 再補上 touches
function touch(type, points) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    event.touches = points.map(([clientX, clientY]) => ({ clientX, clientY }));
    act(() => { window.dispatchEvent(event); });
    return event;
}

const mockCoarse = (coarse) => {
    window.matchMedia = (query) => ({ matches: /pointer: coarse/.test(query) ? coarse : false, addEventListener() {}, removeEventListener() {} });
};

beforeEach(() => {
    mockCoarse(true);
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    vi.stubGlobal('requestAnimationFrame', (cb) => { cb(); return 0; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.documentElement.style.overscrollBehaviorY = ''; });

describe('usePullToRefresh（P6-3）', () => {
    test('在最上面往下拉過門檻再放開：重新整理一次，指示器歸零', () => {
        const onRefresh = vi.fn();
        const { result } = renderHook(() => usePullToRefresh(onRefresh));
        touch('touchstart', [[100, 100]]);
        touch('touchmove', [[100, 120]]);
        expect(result.current.state).toBe('pulling');
        touch('touchmove', [[100, 100 + PULL_LIMIT * 2 + 4]]);
        expect(result.current.state).toBe('ready');
        touch('touchend', []);
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(result.current).toMatchObject({ pull: 0, state: 'idle' });
    });

    test('沒拉到門檻就放開：不重新整理', () => {
        const onRefresh = vi.fn();
        renderHook(() => usePullToRefresh(onRefresh));
        touch('touchstart', [[100, 100]]);
        touch('touchmove', [[100, 130]]);
        touch('touchend', []);
        expect(onRefresh).not.toHaveBeenCalled();
    });

    test('頁面還沒捲到最上面、往上滑、橫向滑、雙指縮放：都不算下拉', () => {
        const onRefresh = vi.fn();
        const { result } = renderHook(() => usePullToRefresh(onRefresh));

        Object.defineProperty(window, 'scrollY', { value: 300, configurable: true });
        touch('touchstart', [[100, 100]]);
        touch('touchmove', [[100, 300]]);
        touch('touchend', []);
        Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });

        touch('touchstart', [[100, 300]]);
        touch('touchmove', [[100, 100]]);                    // 往上
        touch('touchend', []);

        touch('touchstart', [[100, 100]]);
        touch('touchmove', [[260, 150]]);                    // 橫向比直向多
        touch('touchend', []);

        touch('touchstart', [[100, 100], [140, 100]]);       // 兩指
        touch('touchmove', [[100, 300], [140, 300]]);
        touch('touchend', []);

        expect(onRefresh).not.toHaveBeenCalled();
        expect(result.current.state).toBe('idle');
    });

    test('拉的途中又變成往上、或手勢被系統取消：歸零，不重新整理', () => {
        const onRefresh = vi.fn();
        const { result } = renderHook(() => usePullToRefresh(onRefresh));
        touch('touchstart', [[100, 100]]);
        touch('touchmove', [[100, 220]]);
        touch('touchmove', [[100, 90]]);
        expect(result.current.pull).toBe(0);
        touch('touchend', []);
        touch('touchstart', [[100, 100]]);
        touch('touchmove', [[100, 220]]);
        touch('touchcancel', []);
        touch('touchend', []);
        expect(onRefresh).not.toHaveBeenCalled();
    });

    test('滑鼠裝置（不是觸控）與停用時完全不啟動', () => {
        const onRefresh = vi.fn();
        mockCoarse(false);
        renderHook(() => usePullToRefresh(onRefresh));
        touch('touchstart', [[100, 100]]);
        touch('touchmove', [[100, 300]]);
        touch('touchend', []);
        mockCoarse(true);
        renderHook(() => usePullToRefresh(onRefresh, { enabled: false }));
        touch('touchstart', [[100, 100]]);
        touch('touchmove', [[100, 300]]);
        touch('touchend', []);
        expect(onRefresh).not.toHaveBeenCalled();
    });

    test('卸載後不再監聽', () => {
        const onRefresh = vi.fn();
        const { unmount } = renderHook(() => usePullToRefresh(onRefresh));
        unmount();
        touch('touchstart', [[100, 100]]);
        touch('touchmove', [[100, 300]]);
        touch('touchend', []);
        expect(onRefresh).not.toHaveBeenCalled();
    });

    test('接手下拉時擋下瀏覽器自己的下拉（preventDefault）；一般的往上捲動完全不攔', () => {
        renderHook(() => usePullToRefresh(vi.fn()));
        touch('touchstart', [[100, 100]]);
        expect(touch('touchmove', [[100, 140]]).defaultPrevented).toBe(true);
        touch('touchend', []);
        touch('touchstart', [[100, 300]]);
        expect(touch('touchmove', [[100, 200]]).defaultPrevented).toBe(false);
        touch('touchend', []);
    });

    test('啟用期間 <html> 的 overscroll-behavior-y 是 contain，離開（卸載或停用）時還原', () => {
        document.documentElement.style.overscrollBehaviorY = 'auto';
        const { unmount, rerender } = renderHook(({ on }) => usePullToRefresh(vi.fn(), { enabled: on }), { initialProps: { on: true } });
        expect(document.documentElement.style.overscrollBehaviorY).toBe('contain');
        rerender({ on: false });
        expect(document.documentElement.style.overscrollBehaviorY).toBe('auto');
        rerender({ on: true });
        unmount();
        expect(document.documentElement.style.overscrollBehaviorY).toBe('auto');
    });

    test('拉到一半被停用（例如開了彈窗）：指示器歸零，不留舊狀態', () => {
        const { result, rerender } = renderHook(({ on }) => usePullToRefresh(vi.fn(), { enabled: on }), { initialProps: { on: true } });
        touch('touchstart', [[100, 100]]);
        touch('touchmove', [[100, 220]]);
        expect(result.current.state).toBe('ready');
        rerender({ on: false });
        expect(result.current).toMatchObject({ pull: 0, state: 'idle' });
    });

    test('第二根手指按上去、再放開其中一根：整個手勢作廢，不重新整理', () => {
        const onRefresh = vi.fn();
        renderHook(() => usePullToRefresh(onRefresh));
        touch('touchstart', [[100, 100]]);
        touch('touchmove', [[100, 220]]);
        touch('touchend', [[100, 220]]);      // 還有一根手指在螢幕上
        expect(onRefresh).not.toHaveBeenCalled();
    });
});
