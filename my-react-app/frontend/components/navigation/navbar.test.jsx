import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Navbar from './navbar';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/' }),
}));
vi.mock('../../src/userServives/authContext', () => ({
  useAuth: () => ({ userData: null }),
}));
vi.mock('./userSidebar', () => ({
  default: () => null,
}));

describe('Navbar keyboard accessibility', () => {
  // navbar.jsx 桌面版與行動版選單同時渲染在 DOM 裡（用 CSS class 切換顯示/隱藏，
  // 不是條件渲染），同一個選單標籤文字會出現兩次，取第一個（桌面版）即可。
  test('nav menu items are keyboard-focusable and Enter-activatable', () => {
    render(<Navbar />);
    const searchItem = screen.getAllByText('單詞查詢')[0].closest('[role="button"]');
    expect(searchItem).toHaveAttribute('tabIndex', '0');

    fireEvent.keyDown(searchItem, { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith('/search');
  });

  test('nav menu items also respond to the Space key', () => {
    render(<Navbar />);
    const cameraItem = screen.getAllByText('影像辨識')[0].closest('[role="button"]');

    fireEvent.keyDown(cameraItem, { key: ' ' });
    expect(mockNavigate).toHaveBeenCalledWith('/camera');
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
