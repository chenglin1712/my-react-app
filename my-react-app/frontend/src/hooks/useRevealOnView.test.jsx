import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import RevealOnView from '../../components/ui/RevealOnView';
import News from '../../components/_home/news';

vi.mock('swiper/react', () => ({ Swiper: ({ children }) => <div>{children}</div>, SwiperSlide: ({ children }) => <div>{children}</div> }));
vi.mock('swiper/modules', () => ({ Navigation: {}, Autoplay: {}, EffectFade: {} }));
vi.mock('swiper/css', () => ({}));
vi.mock('swiper/css/effect-fade', () => ({}));
vi.mock('swiper/css/navigation', () => ({}));

const originalIO = window.IntersectionObserver;
afterEach(() => {
    window.IntersectionObserver = originalIO;
});

describe('捲動進場（RevealOnView）', () => {
    test('不支援 IntersectionObserver 的環境一開始就是已進場，內容不會被藏起來', () => {
        delete window.IntersectionObserver;
        render(<RevealOnView><p>內容</p></RevealOnView>);
        expect(screen.getByText('內容').parentElement).toHaveClass('is-visible');
    });

    test('捲進視窗前是未進場、進入後變成已進場，且只觸發一次', () => {
        let callback;
        const disconnect = vi.fn();
        window.IntersectionObserver = vi.fn(function MockObserver(cb) {
            callback = cb;
            this.observe = vi.fn();
            this.disconnect = disconnect;
        });
        render(<RevealOnView><p>內容</p></RevealOnView>);
        const wrapper = screen.getByText('內容').parentElement;
        expect(wrapper).not.toHaveClass('is-visible');

        act(() => callback([{ isIntersecting: false }]));
        expect(wrapper).not.toHaveClass('is-visible');

        act(() => callback([{ isIntersecting: true }]));
        expect(wrapper).toHaveClass('is-visible');
        expect(disconnect).toHaveBeenCalled();
    });
});

describe('首頁消息的載入狀態', () => {
    test('資料還沒回來時顯示佔位卡片與讀屏文字，不是空列表', () => {
        render(<News loading />);
        expect(screen.getByRole('status')).toHaveTextContent('最新消息載入中');
        expect(screen.queryByText('目前沒有任何公告')).not.toBeInTheDocument();
    });

    test('載入完成後顯示消息內容', () => {
        render(<News withoutImage={[{ id: 1, title: '測試公告', tag: '公告', start_date: '2026-10-01', detail: '#' }]} />);
        expect(screen.getByText('測試公告')).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
});
