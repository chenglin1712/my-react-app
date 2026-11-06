import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { RouteTransitionProvider, TRANSITION_FAILSAFE_MS, shouldTransition, useDisplayedLocation } from './routeTransition';

const Nav = () => {
    const navigate = useNavigate();
    return (
        <>
            <button onClick={() => navigate('/b')}>去 B</button>
            <button onClick={() => navigate('/a?x=1')}>同頁改參數</button>
            <button onClick={() => navigate(-1)}>上一頁</button>
        </>
    );
};

// 畫面上顯示的是 Routes 依「畫面位置」選的頁，不是真正的網址
const Screen = () => {
    const displayed = useDisplayedLocation();
    return (
        <Routes location={displayed}>
            <Route path="/a" element={<p>頁面 A</p>} />
            <Route path="/b" element={<p>頁面 B</p>} />
        </Routes>
    );
};

const renderApp = () => render(
    <MemoryRouter initialEntries={['/a']}>
        <RouteTransitionProvider>
            <Nav />
            <Screen />
        </RouteTransitionProvider>
    </MemoryRouter>,
);

const setReducedMotion = (reduced) => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: reduced && query.includes('prefers-reduced-motion: reduce'),
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
};

let callbacks;
beforeEach(() => {
    callbacks = [];
    setReducedMotion(false);
    document.startViewTransition = vi.fn((cb) => {
        callbacks.push(cb);
        return { ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    });
});
afterEach(() => {
    delete document.startViewTransition;
    vi.useRealTimers();
});

describe('換頁轉場', () => {
    test('換頁時先停在舊頁並要求瀏覽器轉場，瀏覽器呼叫 callback 才換成新頁', () => {
        renderApp();
        fireEvent.click(screen.getByText('去 B'));
        expect(document.startViewTransition).toHaveBeenCalledTimes(1);
        expect(screen.getByText('頁面 A')).toBeInTheDocument();
        expect(screen.queryByText('頁面 B')).toBeNull();
        act(() => { callbacks[0](); });
        expect(screen.getByText('頁面 B')).toBeInTheDocument();
        expect(screen.queryByText('頁面 A')).toBeNull();
    });

    test('瀏覽器不支援時直接換頁，沒有多一輪延遲', () => {
        delete document.startViewTransition;
        renderApp();
        fireEvent.click(screen.getByText('去 B'));
        expect(screen.getByText('頁面 B')).toBeInTheDocument();
    });

    test('使用者設定減少動態：直接換頁，不啟動轉場', () => {
        setReducedMotion(true);
        renderApp();
        fireEvent.click(screen.getByText('去 B'));
        expect(document.startViewTransition).not.toHaveBeenCalled();
        expect(screen.getByText('頁面 B')).toBeInTheDocument();
    });

    test('路徑沒變（只改網址參數）不是換頁，不轉場', () => {
        renderApp();
        fireEvent.click(screen.getByText('同頁改參數'));
        expect(document.startViewTransition).not.toHaveBeenCalled();
    });

    test('上一頁（POP）直接換，交給瀏覽器還原捲動位置', () => {
        renderApp();
        fireEvent.click(screen.getByText('去 B'));
        act(() => { callbacks[0](); });
        document.startViewTransition.mockClear();
        fireEvent.click(screen.getByText('上一頁'));
        expect(document.startViewTransition).not.toHaveBeenCalled();
        expect(screen.getByText('頁面 A')).toBeInTheDocument();
    });

    test('startViewTransition 丟例外：立刻換頁，不卡住', () => {
        document.startViewTransition = vi.fn(() => { throw new Error('壞了'); });
        renderApp();
        fireEvent.click(screen.getByText('去 B'));
        expect(screen.getByText('頁面 B')).toBeInTheDocument();
    });

    test('瀏覽器一直不呼叫 callback（例如分頁在背景）：保險時間到強制換頁', () => {
        vi.useFakeTimers();
        renderApp();
        fireEvent.click(screen.getByText('去 B'));
        expect(screen.getByText('頁面 A')).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(TRANSITION_FAILSAFE_MS + 1); });
        expect(screen.getByText('頁面 B')).toBeInTheDocument();
    });

    test('轉場進行中又換了一頁：最後停在最新的頁面，不會卡在舊頁', () => {
        const Three = () => {
            const navigate = useNavigate();
            return <><button onClick={() => navigate('/b')}>去 B</button><button onClick={() => navigate('/c')}>去 C</button></>;
        };
        const Pages = () => {
            const displayed = useDisplayedLocation();
            return <Routes location={displayed}><Route path="/a" element={<p>頁面 A</p>} /><Route path="/b" element={<p>頁面 B</p>} /><Route path="/c" element={<p>頁面 C</p>} /></Routes>;
        };
        render(<MemoryRouter initialEntries={['/a']}><RouteTransitionProvider><Three /><Pages /></RouteTransitionProvider></MemoryRouter>);
        fireEvent.click(screen.getByText('去 B'));
        fireEvent.click(screen.getByText('去 C'));
        expect(screen.getByText('頁面 A')).toBeInTheDocument();
        act(() => { callbacks[0](); });
        expect(screen.getByText('頁面 C')).toBeInTheDocument();
    });

    test('useDisplayedLocation 沒有 Provider 時退回真正的位置', () => {
        render(<MemoryRouter initialEntries={['/b']}><Screen /></MemoryRouter>);
        expect(screen.getByText('頁面 B')).toBeInTheDocument();
    });

    test('shouldTransition：POP、同路徑、不支援、減少動態都不轉', () => {
        const a = { pathname: '/a' }; const b = { pathname: '/b' };
        expect(shouldTransition(a, b, 'PUSH')).toBe(true);
        expect(shouldTransition(a, b, 'REPLACE')).toBe(true);
        expect(shouldTransition(a, b, 'POP')).toBe(false);
        expect(shouldTransition(a, { pathname: '/a' }, 'PUSH')).toBe(false);
        setReducedMotion(true);
        expect(shouldTransition(a, b, 'PUSH')).toBe(false);
    });
});
