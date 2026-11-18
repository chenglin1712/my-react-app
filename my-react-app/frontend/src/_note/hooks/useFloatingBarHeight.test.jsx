import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useFloatingBarHeight } from './useFloatingBarHeight';

const VAR = '--note-toolbar-h';

function Page({ showBar }) {
    const ref = useFloatingBarHeight();
    return showBar ? <div ref={ref} data-testid="bar" /> : <p>載入中</p>;
}

afterEach(() => {
    document.documentElement.style.removeProperty(VAR);
    vi.unstubAllGlobals();
});

describe('useFloatingBarHeight（P6-2）', () => {
    test('操作列在載入骨架之後才出現也量得到（callback ref，不是只在第一次渲染量）', () => {
        const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 55.2 });
        const { rerender } = render(<Page showBar={false} />);
        expect(document.documentElement.style.getPropertyValue(VAR)).toBe('');
        rerender(<Page showBar />);
        expect(document.documentElement.style.getPropertyValue(VAR)).toBe('56px');   // 無條件進位，寧可多讓一點
        expect(document.documentElement).toHaveAttribute('data-floating-bar');   // CSS 靠這個屬性（不是 :has()）判斷
        rect.mockRestore();
    });

    test('元素尺寸變了會重新量；元素消失（離開筆記頁）會把變數移除，不影響其他頁', () => {
        let notify;
        class FakeObserver { constructor(cb) { notify = cb; } observe() {} disconnect() {} }
        vi.stubGlobal('ResizeObserver', FakeObserver);
        let height = 55;
        const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height }));
        const { rerender, unmount } = render(<Page showBar />);
        expect(document.documentElement.style.getPropertyValue(VAR)).toBe('55px');
        height = 109;                         // 螢幕變窄，操作列換成兩列
        act(() => notify());
        expect(document.documentElement.style.getPropertyValue(VAR)).toBe('109px');
        rerender(<Page showBar={false} />);
        expect(document.documentElement.style.getPropertyValue(VAR)).toBe('');
        expect(document.documentElement).not.toHaveAttribute('data-floating-bar');
        rerender(<Page showBar />);
        unmount();
        expect(document.documentElement.style.getPropertyValue(VAR)).toBe('');
        expect(document.documentElement).not.toHaveAttribute('data-floating-bar');
        rect.mockRestore();
    });

    test('沒有 ResizeObserver 的環境不會丟例外，只量一次', () => {
        vi.stubGlobal('ResizeObserver', undefined);
        const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 60 });
        expect(() => render(<Page showBar />)).not.toThrow();
        expect(document.documentElement.style.getPropertyValue(VAR)).toBe('60px');
        rect.mockRestore();
    });
});
