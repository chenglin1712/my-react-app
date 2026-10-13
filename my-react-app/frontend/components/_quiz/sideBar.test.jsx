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

  test('手機選單有四個項目，包含「進階-推薦測驗」', async () => {
    mockPathname = '/quiz';
    const user = userEvent.setup();
    render(<SideBar />);
    await user.click(screen.getByRole('button', { name: '開啟選單', hidden: true }));
    const menu = screen.getByRole('navigation', { name: '測驗功能選單', hidden: true });
    ['基礎-等級測驗', '進階-推薦測驗', '答題情形', '重點複習'].forEach((name) => {
      expect(within(menu).getByRole('button', { name: new RegExp(name), hidden: true })).toBeInTheDocument();
    });
  });

  test('進入推薦測驗頁時，手機選單按鈕的圖示不是空的', () => {
    mockPathname = '/quiz/recommon';
    const { container } = render(<SideBar />);
    expect(container.querySelector('.mobile-menu-button svg')).not.toBeNull();
  });

  test('手機選單按鈕有 aria-expanded / aria-controls，Esc 關閉並把焦點還給按鈕', async () => {
    mockPathname = '/quiz';
    const user = userEvent.setup();
    render(<SideBar />);
    const toggle = screen.getByRole('button', { name: '開啟選單', hidden: true });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    const opened = screen.getByRole('button', { name: '關閉選單', expanded: true, hidden: true });
    expect(opened).toHaveAttribute('aria-controls', 'quiz-mobile-menu');
    expect(document.getElementById('quiz-mobile-menu')).not.toBeNull();

    await user.keyboard('{Escape}');
    expect(document.getElementById('quiz-mobile-menu')).toBeNull();
    expect(screen.getByRole('button', { name: '開啟選單', hidden: true })).toHaveFocus();
  });
});
