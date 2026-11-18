import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SideBar from './sideBar';

const mockNavigate = vi.fn();
let mockPathname = '/quiz';
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: mockPathname }),
}));

describe('SideBar（FR-4a：active 狀態改成完全由目前路徑推導，不再另存一份可能不同步的 state）', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  test('路徑是 /quiz/amis/recommon 時，推薦測驗項目顯示 active', () => {
    mockPathname = '/quiz/amis/recommon';
    const { container } = render(<SideBar />);

    expect(container.querySelector('.bar-item.active')).toHaveTextContent('進階-推薦測驗');
  });

  test('路徑是 /quiz/2（泰雅語，無族語前綴）時，基礎測驗項目 active', () => {
    mockPathname = '/quiz/2';
    const { container } = render(<SideBar />);

    expect(container.querySelector('.bar-item.active')).toHaveTextContent('基礎-等級測驗');
  });

  test('路徑是 /quiz/situation 時，答題情形項目 active', () => {
    mockPathname = '/quiz/situation';
    const { container } = render(<SideBar />);

    expect(container.querySelector('.bar-item.active')).toHaveTextContent('答題情形');
  });
});

describe('SideBar 鍵盤與報讀器操作（審查項 P1-1、P1-2）', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  test('側欄項目都是 button，目前頁有 aria-current="page"', () => {
    mockPathname = '/quiz/situation';
    render(<SideBar />);
    const nav = screen.getByRole('navigation', { name: '測驗選單' });
    const current = within(nav).getByRole('button', { name: /答題情形/ });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: /重點複習/ })).not.toHaveAttribute('aria-current');
  });

  test('按 Enter 能切換到推薦測驗（原本 div 沒有鍵盤作用）', async () => {
    mockPathname = '/quiz';
    const user = userEvent.setup();
    render(<SideBar />);
    const nav = screen.getByRole('navigation', { name: '測驗選單' });
    within(nav).getByRole('button', { name: /進階-推薦測驗/ }).focus();
    await user.keyboard('{Enter}');
    expect(mockNavigate).toHaveBeenCalledWith('/quiz/recommon');
  });

  test('桌面側欄與手機頁籤是同一組 button：四個項目都在，包含「進階-推薦測驗」（共用之後手機版不會再漏項）', () => {
    mockPathname = '/quiz';
    render(<SideBar />);
    const nav = screen.getByRole('navigation', { name: '測驗選單' });
    ['基礎-等級測驗', '進階-推薦測驗', '答題情形', '重點複習'].forEach((name) => {
      expect(within(nav).getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
    });
    expect(document.querySelector('.mobile-menu-button')).toBeNull();
  });

  test('分成「測驗」與「紀錄」兩個群組，群組有無障礙名稱（手機頁籤列不顯示標題時仍讀得到）', () => {
    mockPathname = '/quiz';
    render(<SideBar />);
    const quiz = screen.getByRole('group', { name: '測驗' });
    const record = screen.getByRole('group', { name: '紀錄' });
    expect(within(quiz).getAllByRole('button')).toHaveLength(2);
    expect(within(record).getAllByRole('button')).toHaveLength(2);
  });

  test('目前頁有「目前」文字標示（aria-hidden，報讀器讀 aria-current），沒有紅色三角圖示', () => {
    mockPathname = '/quiz/review';
    const { container } = render(<SideBar />);
    const current = container.querySelector('.bar-item.active');
    expect(current).toHaveTextContent('重點複習');
    expect(current.querySelector('.bar-item-current')).toHaveTextContent('目前');
    expect(container.querySelectorAll('.bar-item-current')).toHaveLength(1);
    expect(container.querySelector('.func-hint')).toBeNull();
  });

  test('圖示不寫死顏色（跟著 currentColor），三個入口都達得到：點擊會導向對應路徑', async () => {
    mockPathname = '/quiz';
    const user = userEvent.setup();
    const { container } = render(<SideBar />);
    expect(container.querySelector('[style*="--yy-green"], [style*="--yy-red"], [style*="--yy-gold"]')).toBeNull();
    const nav = screen.getByRole('navigation', { name: '測驗選單' });
    await user.click(within(nav).getByRole('button', { name: /答題情形/ }));
    expect(mockNavigate).toHaveBeenLastCalledWith('/quiz/situation');
    await user.click(within(nav).getByRole('button', { name: /重點複習/ }));
    expect(mockNavigate).toHaveBeenLastCalledWith('/quiz/review');
    await user.click(within(nav).getByRole('button', { name: /基礎-等級測驗/ }));
    expect(mockNavigate).toHaveBeenLastCalledWith('/quiz');
  });

});
