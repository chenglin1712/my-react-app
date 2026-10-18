import { describe, expect, test } from 'vitest';
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import News from './news';

// News 內有連到「所有公告」頁的 <Link>，需要 Router
const render = (ui, options) => rtlRender(ui, { wrapper: MemoryRouter, ...options });

const item = (over) => ({ id: 1, title: '公告', start_date: '2026/10/01', end_date: null, tag: '最新消息', detail: '', image: null, ...over });

describe('News（首頁新聞）空連結處理', () => {
    test('沒有網址的項目不是連結，也沒有「查看詳情」', () => {
        render(<News withImage={[]} withoutImage={[item({ detail: '' })]} loading={false} />);
        expect(screen.queryByRole('link', { name: /查看詳情|另開新視窗/ })).toBeNull();
        expect(screen.getByText('公告')).toBeInTheDocument();
        expect(screen.queryByText(/查看詳情/)).toBeNull();
    });

    test('有網址的項目是另開新視窗的連結，並附報讀器提示', () => {
        render(<News withImage={[]} withoutImage={[item({ detail: 'https://example.org/n' })]} loading={false} />);
        const link = screen.getByRole('link', { name: /另開新視窗/ });
        expect(link).toHaveAttribute('href', 'https://example.org/n');
        expect(link).toHaveTextContent('（另開新視窗）');
    });

    test('有圖版：輪播無網址不顯示「查看詳情」，右側文字列表的無網址項目也不是連結', () => {
        render(
            <News
                withImage={[item({ id: 1, title: '有圖公告', image: 'https://example.org/a.webp', detail: '' })]}
                withoutImage={[item({ id: 2, title: '文字公告', detail: '' })]}
                loading={false}
            />,
        );
        expect(screen.queryByRole('link', { name: /查看詳情/ })).toBeNull();
        expect(screen.getByText('文字公告').closest('div.news-text-item')).not.toBeNull();
        expect(document.body).not.toHaveTextContent('另開新視窗');
    });

    test('有兩張以上輪播圖時有暫停鈕，只有一張時不顯示', () => {
        const slides = [1, 2].map((id) => item({ id, title: `圖${id}`, image: `https://example.org/${id}.webp` }));
        const { unmount } = render(<News withImage={slides} withoutImage={[]} loading={false} />);
        expect(screen.getByRole('button', { name: '暫停自動輪播' })).toBeInTheDocument();
        unmount();
        render(<News withImage={[slides[0]]} withoutImage={[]} loading={false} />);
        expect(screen.queryByRole('button', { name: /自動輪播/ })).toBeNull();
    });

    test('沒有任何消息：顯示「目前沒有新消息」，不是只剩標題', () => {
        render(<News withImage={[]} withoutImage={[]} loading={false} />);
        expect(screen.getByRole('heading', { level: 2, name: '最新消息' })).toBeInTheDocument();
        expect(screen.getByText('目前沒有新消息。')).toBeInTheDocument();
    });

    test('消息標題統一用 h3（接在 h2 之後，不跳級）', () => {
        render(<News withImage={[]} withoutImage={[item({ title: '甲' }), item({ id: 2, title: '乙' })]} loading={false} />);
        expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
        expect(screen.queryAllByRole('heading', { level: 4 })).toHaveLength(0);
    });

    test('全部都沒圖：沒有輪播，整欄是一列一則的列表（最多 5 則），每則有分類標籤與日期', () => {
        const many = Array.from({ length: 7 }, (_, i) => item({ id: i + 1, title: `文字${i + 1}`, tag: '活動' }));
        const { container } = render(<News withImage={[]} withoutImage={many} loading={false} />);
        expect(container.querySelector('.news-carousel')).toBeNull();
        expect(container.querySelectorAll('.text-list--only li')).toHaveLength(5);
        expect(container.querySelector('.text-list--only .news-tag')).toHaveAttribute('data-tag', '活動');
    });

    test('有輪播時下方列表最多 3 則', () => {
        const slides = [item({ id: 1, image: 'https://example.org/1.webp' })];
        const rest = Array.from({ length: 5 }, (_, i) => item({ id: i + 10, title: `文字${i}` }));
        const { container } = render(<News withImage={slides} withoutImage={rest} loading={false} />);
        expect(container.querySelectorAll('.text-list li')).toHaveLength(3);
    });

    test('輪播圖片載入失敗：退回圖樣，不留破圖', () => {
        const slides = [item({ id: 1, image: 'https://example.org/broken.webp' })];
        const { container } = render(<News withImage={slides} withoutImage={[]} loading={false} />);
        fireEvent.error(container.querySelector('.news-slide img'));
        expect(container.querySelector('.news-slide img')).toBeNull();
        expect(container.querySelector('.news-slide-pattern')).not.toBeNull();
    });

    test('載入失敗：顯示錯誤說明與「重新載入」，按了會呼叫 onRetry', () => {
        const onRetry = vi.fn();
        render(<News withImage={[]} withoutImage={[]} loading={false} error onRetry={onRetry} />);
        expect(screen.getByRole('alert')).toHaveTextContent('目前無法載入最新消息，請稍後再試。');
        fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    test('載入中：骨架與給報讀器的說明，標題仍在', () => {
        const { container } = render(<News loading />);
        expect(screen.getByRole('heading', { level: 2, name: '最新消息' })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('最新消息載入中');
        expect(container.querySelector('section')).toHaveAttribute('aria-busy', 'true');
    });

    test('有消息時底部有「查看更多公告」連到所有公告頁；載入中、失敗、沒有消息時不放', () => {
        const { unmount } = render(<News withImage={[]} withoutImage={[item({})]} loading={false} />);
        expect(screen.getByRole('link', { name: /查看更多公告/ })).toHaveAttribute('href', '/announcements');
        unmount();
        const states = [{ loading: true }, { error: true }, {}];
        states.forEach((props) => {
            const { unmount: done } = render(<News withImage={[]} withoutImage={[]} loading={false} {...props} />);
            expect(screen.queryByRole('link', { name: /查看更多公告/ })).toBeNull();
            done();
        });
    });
});
