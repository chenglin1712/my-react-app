import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Footer from './Footer';

describe('Footer', () => {
  test('有關於我們、隱私權、聯絡三個入口，各指向對應頁面；有大字「原語」與標語', () => {
    render(<MemoryRouter><Footer /></MemoryRouter>);
    expect(screen.getByRole('navigation', { name: '頁尾選單' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '關於我們' })).toHaveAttribute('href', '/help');
    expect(screen.getByRole('link', { name: '隱私權' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: '聯絡' })).toHaveAttribute('href', '/contact');
    expect(screen.getAllByText('原語').length).toBeGreaterThan(0);
  });

  test('三欄分組（學習、資源、平台），連結全部對照現有路由，沒有多出來的項目', () => {
    const { container } = render(<MemoryRouter><Footer /></MemoryRouter>);
    const cols = [...container.querySelectorAll('.yy-footer__col')].map((col) => ({
      title: col.querySelector('h2').textContent,
      links: [...col.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]),
    }));
    expect(cols).toEqual([
      { title: '學習', links: [['單詞查詢', '/search'], ['翻譯', '/translate'], ['影像辨識', '/camera'], ['測驗', '/quiz/select'], ['遊戲專區', '/game']] },
      { title: '資源', links: [['寫筆記', '/note'], ['筆記分享區', '/note/share'], ['個人詞語庫', '/favorite']] },
      { title: '平台', links: [['關於我們', '/help'], ['隱私權', '/privacy'], ['聯絡', '/contact']] },
    ]);
  });

  test('浮水印「原語」是裝飾：aria-hidden，不另外報讀', () => {
    const { container } = render(<MemoryRouter><Footer /></MemoryRouter>);
    const mark = container.querySelector('.yy-footer__mark');
    expect(mark).toHaveTextContent('原語');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('讓語言回家')).toBeInTheDocument();
  });

  test('品牌與標語在同一行：原語、圓點（裝飾，不報讀）、讓語言回家', () => {
    const { container } = render(<MemoryRouter><Footer /></MemoryRouter>);
    const brand = container.querySelector('.yy-footer__brand');
    expect([...brand.children].map((el) => el.className)).toEqual(['yy-footer__name', 'yy-footer__dot', 'yy-footer__sub']);
    expect(brand.querySelector('.yy-footer__dot')).toHaveAttribute('aria-hidden', 'true');
  });

  test('底部有版權聲明：年份從 2026 起，之後的年份顯示區間', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-19T12:00:00'));
      const first = render(<MemoryRouter><Footer /></MemoryRouter>);
      expect(screen.getByText(/© 2026 原語 YUAN・YU\. 版權所有/)).toBeInTheDocument();
      first.unmount();
      vi.setSystemTime(new Date('2028-03-01T12:00:00'));
      render(<MemoryRouter><Footer /></MemoryRouter>);
      expect(screen.getByText(/© 2026-2028 原語 YUAN・YU\. 版權所有/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
