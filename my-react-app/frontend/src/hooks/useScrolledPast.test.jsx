import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useScrolledPast } from './useScrolledPast';

const Probe = () => {
    const [ref, past, offset] = useScrolledPast();
    return <div><div ref={ref} data-testid="target" /><span data-testid="out">{`${past}|${offset}`}</span></div>;
};

const originalIO = window.IntersectionObserver;
afterEach(() => { window.IntersectionObserver = originalIO; document.body.innerHTML = ''; });

const mockObserver = () => {
    let callback;
    window.IntersectionObserver = vi.fn(function MockObserver(cb) {
        callback = cb;
        this.observe = vi.fn();
        this.disconnect = vi.fn();
    });
    return (entry) => act(() => callback([entry]));
};

describe('useScrolledPast', () => {
    test('不支援 IntersectionObserver 時永遠是 false，不會丟例外', () => {
        delete window.IntersectionObserver;
        render(<Probe />);
        expect(screen.getByTestId('out').textContent).toBe('false|90');
    });

    test('區塊被捲到視窗上方時是 true，捲回來變 false；在視窗下方（還沒捲到）不算', () => {
        const fire = mockObserver();
        render(<Probe />);
        fire({ isIntersecting: false, boundingClientRect: { bottom: 10 } });
        expect(screen.getByTestId('out').textContent).toBe('true|90');
        fire({ isIntersecting: true, boundingClientRect: { bottom: 400 } });
        expect(screen.getByTestId('out').textContent).toBe('false|90');
        fire({ isIntersecting: false, boundingClientRect: { bottom: 2000 } });
        expect(screen.getByTestId('out').textContent).toBe('false|90');
    });

    test('偏移量取自導覽列的實際高度', () => {
        document.body.innerHTML = '<nav class="navbar"></nav>';
        Object.defineProperty(document.querySelector('.navbar'), 'offsetHeight', { value: 72 });
        render(<Probe />);
        expect(screen.getByTestId('out').textContent.endsWith('|72')).toBe(true);
    });
});
