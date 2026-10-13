import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Navbar from './navbar';

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/' }),
  // 導頁項目改用真正的 NavLink（FR-1）：測試用一個輕量的假 <a> 取代，
  // 只需要能斷言 href／點擊後關閉選單這兩件事，不需要真的 React Router context。
  // jsdom 沒有實作真的頁面導覽，真的觸發 <a> 的預設行為會印出
  // "Not implemented: navigation to another Document" 噪音；preventDefault
  // 讓這個假元件單純模擬「不會真的換頁、但仍會呼叫 onClick」。
  NavLink: ({ to, className, children, onClick }) => (
    <a
      href={to}
      className={typeof className === 'function' ? className({ isActive: false }) : className}
      onClick={(e) => { e.preventDefault(); onClick?.(); }}
    >
      {children}
    </a>
  ),
}));
const authState = vi.hoisted(() => ({ userData: null }));
vi.mock('../../src/userServives/authContext', () => ({
  useAuth: () => ({ userData: authState.userData }),
}));
vi.mock('./userSidebar', () => ({
  default: () => <button type="button">登出</button>,
}));

describe('Navbar navigation links', () => {
  // navbar.jsx 桌面版與行動版選單同時渲染在 DOM 裡（用 CSS class 切換顯示/隱藏，
  // 不是條件渲染），同一個選單標籤文字會出現兩次，取第一個（桌面版）即可。
  test('nav items render as real links pointing at their routes', () => {
    render(<Navbar />);
    const searchLink = screen.getAllByText('單詞查詢')[0].closest('a');
    expect(searchLink).toHaveAttribute('href', '/search');

    const cameraLink = screen.getAllByText('影像辨識')[0].closest('a');
    expect(cameraLink).toHaveAttribute('href', '/camera');
  });

  test('mobile nav link closes the mobile menu on click', () => {
    render(<Navbar />);
    const mobileSearchLink = screen.getAllByText('單詞查詢')[1].closest('a');
    // 點擊不應該拋出例外；onClick 會呼叫 setIsOpen(false) 收合手機選單。
    expect(() => mobileSearchLink.click()).not.toThrow();
  });

  test('mobile menu toggle button has an accessible name', () => {
    // .menu-toggle 預設 display:none（只在行動版寬度的 media query 下才顯示），
    // jsdom 沒有實際的 viewport，getByRole 會依可見性把它排除在可存取樹之外，
    // 所以直接用 querySelector 取得元素、檢查 aria-label 屬性本身。
    const { container } = render(<Navbar />);
    const toggleButton = container.querySelector('.menu-toggle');
    expect(toggleButton).toHaveAttribute('aria-label', '開啟選單');
  });
});

describe('Navbar 使用者側欄（審查項 P1-5、P2-1、P2-2）', () => {
  beforeEach(() => {
    authState.userData = { firestoreData: { name: '小明' } };
  });
  afterEach(() => {
    authState.userData = null;
    document.body.style.overflow = '';
  });

  test('使用者按鈕的名稱以可見的使用者名稱開頭（語音控制說出名稱即可啟動）', () => {
    render(<Navbar />);
    const buttons = screen.getAllByRole('button', { name: /小明/, hidden: true });
    expect(buttons.length).toBe(2);
    buttons.forEach((btn) => expect(btn.getAttribute('aria-label').startsWith('小明')).toBe(true));
  });

  test('側欄與遮罩只渲染一份（原本桌面與手機各一份）', async () => {
    const user = userEvent.setup();
    const { container } = render(<Navbar />);
    expect(container.querySelectorAll('.sidebar').length).toBe(1);
    await user.click(screen.getAllByRole('button', { name: /開啟個人資料選單/, hidden: true })[0]);
    expect(container.querySelectorAll('.navbar-overlay').length).toBe(1);
  });

  test('側欄是 dialog：開啟時焦點移進去、按鈕 aria-expanded 變 true、Esc 關閉並把焦點還給按鈕', async () => {
    const user = userEvent.setup();
    render(<Navbar />);
    const trigger = screen.getAllByRole('button', { name: /開啟個人資料選單/, hidden: true })[0];
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    trigger.focus();
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: '個人資料' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(container_open()).toBe(false);
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('');

    function container_open() {
      return document.querySelector('.sidebar.open') !== null;
    }
  });

  test('側欄開啟時 Tab 不會跑到背景導覽列', async () => {
    const user = userEvent.setup();
    render(<Navbar />);
    await user.click(screen.getAllByRole('button', { name: /開啟個人資料選單/, hidden: true })[0]);
    const dialog = screen.getByRole('dialog', { name: '個人資料' });
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    expect(within(dialog).getByRole('button', { name: '登出' })).toBeInTheDocument();
  });
});

describe('Navbar 側欄收起時 inert（Codex 審查：關閉動畫期間不可仍宣告為 modal）', () => {
  test('收起時側欄是 inert，開啟時移除', async () => {
    authState.userData = { firestoreData: { name: '小明' } };
    const user = userEvent.setup();
    const { container } = render(<Navbar />);
    const sidebar = container.querySelector('.sidebar');
    expect(sidebar.hasAttribute('inert')).toBe(true);
    await user.click(screen.getAllByRole('button', { name: /開啟個人資料選單/, hidden: true })[0]);
    expect(sidebar.hasAttribute('inert')).toBe(false);
    await user.keyboard('{Escape}');
    expect(sidebar.hasAttribute('inert')).toBe(true);
    authState.userData = null;
  });
});
