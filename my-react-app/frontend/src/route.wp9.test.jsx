// 稽核 WP-9：route.jsx 的公開頁 error boundary 換頁復原（FE1-06）、/reset 受登入保護（FE1-17）。
// 頁面元件全部換成輕量替身，只驗證路由層的行為。
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Link } from 'react-router-dom';
import AppRoutes from './route';

const authState = vi.hoisted(() => ({ userData: null, loading: false }));
vi.mock('./userServives/authContext', () => ({ useAuth: () => authState }));
const homeState = vi.hoisted(() => ({ crash: false }));
vi.mock('./_home/index', () => ({
  default: () => {
    if (homeState.crash) throw new Error('首頁壞了');
    return <p>首頁內容</p>;
  },
}));
vi.mock('./_search/index', () => ({ default: () => <p>單詞查詢內容</p> }));
vi.mock('../components/_auth/resetPassword', () => ({ default: () => <p>變更密碼表單</p> }));

const Nav = () => (
  <nav>
    <Link to="/">去首頁</Link>
    <Link to="/search">去查詢</Link>
  </nav>
);

const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Nav />
    <AppRoutes />
  </MemoryRouter>,
);

describe('公開頁出錯後換頁會復原（稽核 FE1-06）', () => {
  beforeEach(() => {
    homeState.crash = false;
    authState.userData = null;
  });

  test('首頁丟例外顯示錯誤畫面；點導覽列換到單詞查詢就恢復正常', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    homeState.crash = true;
    renderAt('/');
    expect(await screen.findByText('哎呀，頁面發生錯誤')).toBeInTheDocument();

    fireEvent.click(screen.getByText('去查詢'));
    expect(await screen.findByText('單詞查詢內容')).toBeInTheDocument();
    expect(screen.queryByText('哎呀，頁面發生錯誤')).not.toBeInTheDocument();
    console.error.mockRestore();
  });
});

describe('/reset 受登入保護（稽核 FE1-17）', () => {
  test('未登入開 /reset 看到登入牆，不會看到變更密碼表單', async () => {
    authState.userData = null;
    renderAt('/reset');
    expect(await screen.findByText('請先登入才可使用「變更密碼」')).toBeInTheDocument();
    expect(screen.queryByText('變更密碼表單')).not.toBeInTheDocument();
  });

  test('已登入可以進 /reset', async () => {
    authState.userData = { uid: 'u1', firestoreData: { name: '小明' } };
    renderAt('/reset');
    expect(await screen.findByText('變更密碼表單')).toBeInTheDocument();
  });
});
