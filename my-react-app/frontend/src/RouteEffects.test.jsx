import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import RouteEffects from './RouteEffects';

const Harness = () => {
    const navigate = useNavigate();
    return (
        <>
            <RouteEffects />
            <button onClick={() => navigate('/search')}>前往查詢</button>
            <button onClick={() => navigate('/translate')}>前往翻譯</button>
            <button onClick={() => navigate(-1)}>上一頁</button>
            <input aria-label="輸入框" />
            <main id="main-content"><h1>單詞查詢</h1></main>
        </>
    );
};

const flushFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

afterEach(() => { vi.restoreAllMocks(); document.title = ''; });

describe('換頁時的標題、捲動與焦點', () => {
    test('進站就設定分頁標題，換頁後更新', () => {
        render(<MemoryRouter initialEntries={['/login']}><Harness /></MemoryRouter>);
        expect(document.title).toBe('登入｜源·語');
        fireEvent.click(screen.getByText('前往翻譯'));
        expect(document.title).toBe('翻譯｜源·語');
    });

    test('一般換頁捲回頂端並把焦點移到新頁的 h1', async () => {
        const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
        render(<MemoryRouter initialEntries={['/']}><Harness /></MemoryRouter>);
        expect(scrollTo).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('前往查詢'));
        await act(flushFrame);
        expect(scrollTo).toHaveBeenCalled();
        expect(document.activeElement).toBe(document.querySelector('h1'));
    });

    test('使用者正在輸入時不搶焦點', async () => {
        vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
        render(<MemoryRouter initialEntries={['/']}><Harness /></MemoryRouter>);
        const input = screen.getByLabelText('輸入框');
        input.focus();
        // 用程式觸發換頁（不經過按鈕，焦點才會一直留在輸入框）
        fireEvent.click(screen.getByText('前往查詢'));
        input.focus();
        await act(flushFrame);
        expect(document.activeElement).toBe(input);
    });

    test('上一頁（POP）不改捲動位置', async () => {
        const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
        render(<MemoryRouter initialEntries={['/', '/search']} initialIndex={1}><Harness /></MemoryRouter>);
        fireEvent.click(screen.getByText('上一頁'));
        await act(flushFrame);
        expect(scrollTo).not.toHaveBeenCalled();
    });
});
