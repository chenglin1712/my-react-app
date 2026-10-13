import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import News from './news';

const item = (over) => ({ id: 1, title: '公告', start_date: '2026/10/01', end_date: null, tag: '最新消息', detail: '', image: null, ...over });

describe('News（首頁新聞）空連結處理', () => {
    test('沒有網址的項目不是連結，也沒有「查看詳情」', () => {
        render(<News withImage={[]} withoutImage={[item({ detail: '' })]} loading={false} />);
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByText('公告')).toBeInTheDocument();
        expect(screen.queryByText(/查看詳情/)).toBeNull();
    });

    test('有網址的項目是另開新視窗的連結，並附報讀器提示', () => {
        render(<News withImage={[]} withoutImage={[item({ detail: 'https://example.org/n' })]} loading={false} />);
        const link = screen.getByRole('link');
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
        expect(screen.getByText('文字公告').closest('div.text-item')).not.toBeNull();
        expect(document.body).not.toHaveTextContent('另開新視窗');
    });
});
