// 手機底部 tab bar（步驟 2-4）：四個主入口加「更多」，更多開關手機選單面板。
import { describe, test, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Navbar from './navbar';

const loc = vi.hoisted(() => ({ pathname: '/search' }));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: loc.pathname }),
  NavLink: ({ to, className, children, onClick, ...rest }) => (
    <a href={to} className={className} onClick={(e) => { e.preventDefault(); onClick?.(); }} {...rest}>{children}</a>
  ),
}));
vi.mock('../../src/userServives/authContext', () => ({ useAuth: () => ({ userData: null }) }));
vi.mock('./userSidebar', () => ({ default: () => null }));

describe('手機底部 tab bar', () => {
  test('主要分頁導覽：首頁、單詞查詢、測驗、遊戲專區四個連結加「更多」按鈕，順序固定', () => {
    const view = render(<Navbar />);
    const { container } = view;
    const bar = container.querySelector('.yy-tabbar');
    expect(bar).toHaveAttribute('aria-label', '主要分頁');
    const items = [...bar.querySelectorAll('.yy-tabbar__item')];
    expect(items.map((el) => el.textContent)).toEqual(['首頁', '單詞查詢', '測驗', '遊戲專區', '更多']);
    expect(items.slice(0, 4).map((el) => el.getAttribute('href'))).toEqual(['/', '/search', '/quiz/select', '/game']);
    expect(within(bar).getByRole('button', { name: '更多', hidden: true })).toBeInTheDocument();
  });

  test('目前頁有 aria-current=page，其餘沒有', () => {
    const view = render(<Navbar />);
    const { container } = view;
    const bar = container.querySelector('.yy-tabbar');
    expect(bar).toHaveAttribute('aria-label', '主要分頁');
    const current = bar.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('單詞查詢');
  });

  test('「更多」開關手機選單面板（aria-expanded／aria-controls），Esc 收起', async () => {
    const user = userEvent.setup();
    const { container } = render(<Navbar />);
    const more = screen.getByRole('button', { name: '更多', hidden: true });
    expect(more).toHaveAttribute('aria-controls', 'mobile-menu');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('#mobile-menu')).toHaveClass('active');
    await user.keyboard('{Escape}');
    expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  test('手機寬度開啟「更多」：焦點移到面板第一個可按項目；Esc 收起後回到「更多」', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
    try {
      const user = userEvent.setup();
      const { container } = render(<Navbar />);
      const more = screen.getByRole('button', { name: '更多', hidden: true });
      await user.click(more);
      const first = container.querySelector('#mobile-menu a:not(.menu-mobile-item--in-tabbar), #mobile-menu button');
      expect(first).toHaveFocus();
      await user.keyboard('{Escape}');
      expect(more).toHaveFocus();
    } finally {
      delete window.matchMedia;
    }
  });

  test('兩個導覽地標各有唯一名稱', () => {
    const { container } = render(<Navbar />);
    const names = [...container.querySelectorAll('nav')].map((n) => n.getAttribute('aria-label')).filter(Boolean);
    expect(names.sort()).toEqual(['主要分頁', '網站導覽']);
  });

  test('面板保留其餘入口（翻譯、影像辨識、筆記），tab bar 已有的四個入口標記為手機寬度隱藏', () => {
    const { container } = render(<Navbar />);
    const panel = container.querySelector('#mobile-menu');
    const hidden = [...panel.querySelectorAll('.menu-mobile-item--in-tabbar')].map((el) => el.textContent);
    expect(hidden.sort()).toEqual(['測驗', '遊戲專區', '單詞查詢', '首頁'].sort());
    ['翻譯', '影像辨識', '寫筆記', '筆記分享區'].forEach((t) => expect(within(panel).getByText(t)).toBeInTheDocument());
  });
});
