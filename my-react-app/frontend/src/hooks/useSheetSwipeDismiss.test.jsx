import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import useSheetSwipeDismiss, {
    MAX_OVERSCROLL, SNAP_MS, VELOCITY_DISMISS, dampedOffset, shouldDismiss,
} from './useSheetSwipeDismiss';

// jsdom 沒有 PointerEvent：補一個最小版，clientY、pointerId、pointerType、isPrimary 才讀得到
beforeEach(() => {
    if (!window.PointerEvent) {
        window.PointerEvent = class extends MouseEvent {
            constructor(type, init = {}) {
                super(type, init);
                this.pointerId = init.pointerId ?? 1;
                this.pointerType = init.pointerType ?? 'touch';
                this.isPrimary = init.isPrimary ?? true;
            }
        };
    }
    window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const Sheet = ({ enabled = true, onDismiss }) => {
    const swipe = useSheetSwipeDismiss({ enabled, onDismiss });
    return (
        <div className="offcanvas" data-testid="sheet">
            <div data-testid="head" {...swipe}>
                <button type="button">收藏</button>
                <span data-testid="grip">把手</span>
            </div>
        </div>
    );
};

const touch = (el, type, clientY, extra = {}) => fireEvent(el, new window.PointerEvent(type, { bubbles: true, clientY, pointerId: 1, pointerType: 'touch', isPrimary: true, ...extra }));

let now;
const setup = (props = {}) => {
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const onDismiss = vi.fn();
    render(<Sheet onDismiss={onDismiss} {...props} />);
    vi.spyOn(screen.getByTestId('sheet'), 'getBoundingClientRect').mockReturnValue({ height: 600 });
    return { onDismiss, head: screen.getByTestId('head'), grip: screen.getByTestId('grip'), sheet: screen.getByTestId('sheet') };
};

describe('數學規則', () => {
    test('往下原樣跟手；往上越拉越吃力，永遠不超過上限且單調', () => {
        expect(dampedOffset(80)).toBe(80);
        expect(dampedOffset(0)).toBe(0);
        const pulled = [-10, -40, -200, -2000].map(dampedOffset);
        pulled.forEach((value) => { expect(value).toBeLessThan(0); expect(value).toBeGreaterThan(-MAX_OVERSCROLL - 1e-9); });
        expect(pulled[0]).toBeGreaterThan(pulled[1]);
        expect(pulled[1]).toBeGreaterThan(pulled[2]);
    });

    test('速度門檻 0.11：夠快就關，不必拖到一半', () => {
        expect(shouldDismiss({ dy: 40, elapsed: 100, height: 600 })).toBe(true); // 0.4 px/ms
        expect(shouldDismiss({ dy: 40, elapsed: 40 / (VELOCITY_DISMISS - 0.01), height: 600 })).toBe(false);
    });

    test('輕點的抖動（很短的距離、很短的時間）不算輕彈', () => {
        expect(shouldDismiss({ dy: 4, elapsed: 8, height: 600 })).toBe(false);
    });

    test('慢慢拖要超過高度的 35%；往上或沒動不關', () => {
        expect(shouldDismiss({ dy: 209, elapsed: 5000, height: 600 })).toBe(false);
        expect(shouldDismiss({ dy: 210, elapsed: 5000, height: 600 })).toBe(true);
        expect(shouldDismiss({ dy: -300, elapsed: 50, height: 600 })).toBe(false);
        expect(shouldDismiss({ dy: 0, elapsed: 50, height: 600 })).toBe(false);
    });
});

describe('手勢', () => {
    test('拖動時 sheet 跟著手指（只改 transform），沒有動畫延遲', () => {
        const { grip, sheet } = setup();
        touch(grip, 'pointerdown', 100);
        expect(sheet.style.transition).toBe('none');
        touch(grip, 'pointermove', 160);
        expect(sheet.style.transform).toBe('translateY(60px)');
    });

    test('快速輕彈：立刻通知關閉（不串成兩段退場），同時 sheet 自己收到畫面外，之後清掉 inline 樣式', () => {
        vi.useFakeTimers();
        const { grip, sheet, onDismiss } = setup();
        touch(grip, 'pointerdown', 100);
        now += 80;
        touch(grip, 'pointermove', 150);
        touch(grip, 'pointerup', 150);
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(sheet.style.transform).toBe('translateY(100%)');
        act(() => { vi.advanceTimersByTime(SNAP_MS * 2 + 1); });
        expect(sheet.style.transform).toBe('');
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    test('拖得不夠遠也不夠快：回彈到原位，不關', () => {
        vi.useFakeTimers();
        const { grip, sheet, onDismiss } = setup();
        touch(grip, 'pointerdown', 100);
        now += 2000;
        touch(grip, 'pointermove', 160);
        touch(grip, 'pointerup', 160);
        expect(sheet.style.transform).toBe('');
        act(() => { vi.advanceTimersByTime(SNAP_MS + 10); });
        expect(onDismiss).not.toHaveBeenCalled();
        expect(sheet.style.transition).toBe('');
    });

    test('往上拉有阻尼，放手回彈不關', () => {
        const { grip, sheet, onDismiss } = setup();
        touch(grip, 'pointerdown', 300);
        touch(grip, 'pointermove', 0);
        const offset = Number.parseFloat(sheet.style.transform.replace(/[^-\d.]/g, ''));
        expect(offset).toBeLessThan(0);
        expect(offset).toBeGreaterThan(-MAX_OVERSCROLL - 1e-9);
        touch(grip, 'pointerup', 0);
        expect(onDismiss).not.toHaveBeenCalled();
    });

    test('多指保護：第二根手指的按下與移動都被忽略，位置不跳', () => {
        const { grip, sheet } = setup();
        touch(grip, 'pointerdown', 100);
        touch(grip, 'pointermove', 140);
        touch(grip, 'pointerdown', 400, { pointerId: 2, isPrimary: false });
        touch(grip, 'pointermove', 500, { pointerId: 2, isPrimary: false });
        expect(sheet.style.transform).toBe('translateY(40px)');
        touch(grip, 'pointerup', 500, { pointerId: 2, isPrimary: false });
        touch(grip, 'pointermove', 150);
        expect(sheet.style.transform).toBe('translateY(50px)');
    });

    test('滑鼠不拖（只有觸控與筆）', () => {
        const { grip, sheet } = setup();
        touch(grip, 'pointerdown', 100, { pointerType: 'mouse' });
        touch(grip, 'pointermove', 200, { pointerType: 'mouse' });
        expect(sheet.style.transform).toBe('');
    });

    test('從標題列上的按鈕開始不拖（按鈕照常是按鈕）', () => {
        const { sheet } = setup();
        const button = screen.getByRole('button', { name: '收藏' });
        touch(button, 'pointerdown', 100);
        touch(button, 'pointermove', 200);
        expect(sheet.style.transform).toBe('');
    });

    test('沒啟用（桌面）：完全沒有事件處理', () => {
        const { grip, sheet } = setup({ enabled: false });
        touch(grip, 'pointerdown', 100);
        touch(grip, 'pointermove', 300);
        expect(sheet.style.transform).toBe('');
    });

    test('系統取消（pointercancel，例如來電）：回彈，不關', () => {
        const { grip, sheet, onDismiss } = setup();
        touch(grip, 'pointerdown', 100);
        now += 20;
        touch(grip, 'pointermove', 400);
        touch(grip, 'pointercancel', 400);
        expect(onDismiss).not.toHaveBeenCalled();
        expect(sheet.style.transform).toBe('');
    });

    test('減少動態：輕彈後立刻通知關閉，沒有收回動畫', () => {
        window.matchMedia = vi.fn().mockImplementation((q) => ({ matches: q.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
        const { grip, onDismiss } = setup();
        touch(grip, 'pointerdown', 100);
        now += 60;
        touch(grip, 'pointermove', 160);
        touch(grip, 'pointerup', 160);
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    test('卸載後計時器被清掉，不會對已卸載的畫面動手腳', () => {
        vi.useFakeTimers();
        now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        const onDismiss = vi.fn();
        const { unmount } = render(<Sheet onDismiss={onDismiss} />);
        const grip = screen.getByTestId('grip');
        touch(grip, 'pointerdown', 100);
        now += 50;
        touch(grip, 'pointermove', 160);
        touch(grip, 'pointerup', 160);
        unmount();
        expect(() => act(() => { vi.advanceTimersByTime(SNAP_MS * 4); })).not.toThrow();
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });
});
