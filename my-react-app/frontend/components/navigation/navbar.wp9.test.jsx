// 稽核 WP-9（FE1-02、FE1-20）：用真的 react-router（MemoryRouter）驗證 NavLink 的 aria-current，
// 其他 navbar 測試把 NavLink 換成假 <a>，看不到 react-router 自己加的 aria-current。
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Navbar from './navbar';

const authState = vi.hoisted(() => ({ userData: null }));
vi.mock('../../src/userServives/authContext', () => ({
  useAuth: () => ({ userData: authState.userData }),
}));
vi.mock('./userSidebar', () => ({ default: () => <p>側欄內容</p> }));

const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Navbar />
  </MemoryRouter>,
);

const currentLabels = (container, selector) => Array.from(container.querySelectorAll(`${selector}[aria-current="page"]`))
  .map((el) => el.textContent.trim());

afterEach(() => {
  authState.userData = null;
});

describe('導覽列 aria-current（稽核 FE1-20）', () => {
  test('在 /quiz/tayal 等測驗子頁，桌面與手機選單的「測驗」都標成目前頁', () => {
    const { container } = renderAt('/quiz/tayal');
    expect(currentLabels(container, '.menu > a')).toEqual(['測驗']);
    expect(currentLabels(container, '#mobile-menu > a')).toEqual(['測驗']);
  });

  test('在 /note/share 只有「筆記分享區」是目前頁，「寫筆記」不是', () => {
    const { container } = renderAt('/note/share');
    expect(currentLabels(container, '#note-dropdown-menu a')).toEqual(['筆記分享區']);
    expect(currentLabels(container, '#mobile-menu > a')).toEqual(['筆記分享區']);
  });

  test('在 /note 時「寫筆記」仍是目前頁', () => {
    const { container } = renderAt('/note');
    expect(currentLabels(container, '#note-dropdown-menu a')).toEqual(['寫筆記']);
  });

  test('首頁只標「首頁」，不會連帶標到其他項目', () => {
    const { container } = renderAt('/');
    expect(currentLabels(container, '.menu > a')).toEqual(['首頁']);
  });
});

describe('登出後側欄狀態歸零（稽核 FE1-02）', () => {
  test('側欄開著時登出，再次登入時側欄是收起的', () => {
    authState.userData = { uid: 'u1', firestoreData: { name: '小明' } };
    const view = renderAt('/');
    fireEvent.click(screen.getAllByRole('button', { name: /開啟個人資料選單/ })[0]);
    expect(document.querySelector('#user-sidebar')).toHaveClass('open');

    // 被動或主動登出：AuthContext 的 userData 變成 null
    authState.userData = null;
    view.rerender(<MemoryRouter initialEntries={['/']}><Navbar /></MemoryRouter>);
    expect(document.querySelector('#user-sidebar')).toBeNull();

    // 同一分頁換人登入
    authState.userData = { uid: 'u2', firestoreData: { name: '小華' } };
    view.rerender(<MemoryRouter initialEntries={['/']}><Navbar /></MemoryRouter>);
    const sidebar = document.querySelector('#user-sidebar');
    expect(sidebar).not.toHaveClass('open');
    expect(document.querySelector('.navbar-overlay')).toBeNull();
  });
});
