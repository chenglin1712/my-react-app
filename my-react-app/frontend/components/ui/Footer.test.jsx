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
    expect(screen.getByText('原語')).toBeInTheDocument();
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
