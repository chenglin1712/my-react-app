import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
vi.mock('../../src/userServives/authContext', () => ({
  useAuth: () => ({ userData: null }),
}));
vi.mock('./userSidebar', () => ({
  default: () => null,
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
