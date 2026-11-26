// 正式入口改成 data router（createBrowserRouter + RouterProvider）後，確認真實的 AppShell 與 route.jsx
// 裡的巢狀 <Routes> 在 data router 底下照常比對、換頁與上一頁。這裡用 createMemoryRouter 搭同一份
// appRoutes（兩者只差歷史紀錄存在哪裡），只 mock 登入狀態與會碰到後端／Firebase 的模組。
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

import { appRoutes } from './appRoutes';

// 第一次載入 lazy 的 404 頁 chunk 較慢，完整測試並行時預設 5 秒可能不夠
vi.setConfig({ testTimeout: 20000 });

// jsdom 沒有 canvas，真實的 lottie-web 在 import 當下就會丟例外
vi.mock('lottie-web', () => ({ default: { loadAnimation: vi.fn(() => ({ destroy: vi.fn(), addEventListener: vi.fn() })) } }));
vi.mock('../components/ui/Footer', () => ({ default: () => null }));
vi.mock('../utils/apiClient', () => ({ apiPost: vi.fn(), apiGet: vi.fn().mockResolvedValue({}) }));
vi.mock('./userServives/uploadDb', () => ({
  getUserSituation: vi.fn().mockResolvedValue({ level: 'beginner' }),
  addCalendarEvent: vi.fn(),
  addCalendarEvents: vi.fn(),
}));
vi.mock('./userServives/userServive', () => ({ signOut: vi.fn(), authChanges: vi.fn(() => () => {}) }));
vi.mock('./userServives/authContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ userData: null, loading: false }),
}));

function renderApp(initialEntries, initialIndex = initialEntries.length - 1) {
  const router = createMemoryRouter(appRoutes, { initialEntries, initialIndex });
  render(<RouterProvider router={router} />);
  return router;
}

describe('appRoutes：data router 底下的整個 App', () => {
  test('沒有對應的網址落到 route.jsx 的 404 頁，前台導覽列也在', async () => {
    renderApp(['/no-such-page']);
    expect(await screen.findByRole('heading', { name: '找不到這個頁面' }, { timeout: 10000 })).toBeInTheDocument();
    expect(document.getElementById('main-content')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '跳到主要內容' })).toBeInTheDocument();
  });

  test('「回上一頁」（navigate(-1)，POP）在 data router 底下照常回到前一筆歷史', async () => {
    const user = userEvent.setup();
    const router = renderApp(['/missing-a', '/missing-b']);
    await screen.findByRole('heading', { name: '找不到這個頁面' }, { timeout: 10000 });

    await user.click(screen.getByRole('button', { name: '回上一頁' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/missing-a'));
    expect(router.state.historyAction).toBe('POP');
  });

  test('程式導頁換到另一個沒有對應的網址，畫面跟著換、歷史紀錄是 PUSH', async () => {
    const router = renderApp(['/missing-a']);
    await screen.findByRole('heading', { name: '找不到這個頁面' }, { timeout: 10000 });

    await router.navigate('/missing-c?x=1');
    await waitFor(() => expect(router.state.location.pathname).toBe('/missing-c'));
    expect(router.state.location.search).toBe('?x=1');
    expect(router.state.historyAction).toBe('PUSH');
    expect(screen.getByRole('heading', { name: '找不到這個頁面' })).toBeInTheDocument();
  });
});
