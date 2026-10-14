import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';
import CharReveal from './CharReveal';

const delays = (container) => [...container.querySelectorAll('.yy-char')].map((el) => parseFloat(el.style.animationDelay));

describe('CharReveal 逐字進場', () => {
    test('短標題照預設間隔，最後一字不超過 maxDelay', () => {
        const { container } = render(<CharReveal text="五族語言" />);
        const list = delays(container);
        expect(list).toHaveLength(4);
        expect(list[1] - list[0]).toBeCloseTo(0.045, 3);
        expect(Math.max(...list)).toBeLessThanOrEqual(0.4);
    });

    test('字數多或起點晚時縮短間隔，總延遲仍在 0.4 秒內', () => {
        const { container } = render(<CharReveal text="裡的學習旅程" start={0.2} />);
        const list = delays(container);
        expect(list[0]).toBeCloseTo(0.2, 3);
        expect(Math.max(...list)).toBeLessThanOrEqual(0.4 + 1e-9);
    });

    test('超過 12 字改成整句淡入，不拆字', () => {
        const { container } = render(<CharReveal text="這是一個非常非常長的標題文字" />);
        expect(container.querySelectorAll('.yy-char')).toHaveLength(1);
        expect(container.querySelector('.yy-char--line')).toHaveTextContent('這是一個非常非常長的標題文字');
        expect(container.querySelector('.yy-char')).toHaveAttribute('aria-hidden', 'true');
    });

    test('單一字元不會除以零', () => {
        const { container } = render(<CharReveal text="語" start={0.1} />);
        expect(delays(container)).toEqual([0.1]);
    });
});
