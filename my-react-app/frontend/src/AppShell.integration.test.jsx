// 整合測試：用「真實」的 Navbar、UserSidebar、AI 助手（lazy 載入）與真實的 Router，
// 只 mock 登入狀態、後端 API 與路由內容。
//
// 這個專案原本的元件測試全部把相鄰元件 mock 掉（navbar.test 把 userSidebar mock 成 null、
// bot.test 把 Router 與 Auth 都 mock 掉），所以「從側邊欄點開 AI 助手」這條跨元件路徑
// 從來沒有被測過；AI 助手層級與樣式衝突導致整頁無法操作的問題因此漏網。
// jsdom 不做版面計算，這裡驗證的是流程與 DOM 結構（開得起來、關得掉、不殘留遮罩），
// CSS 命名衝突另外由 frontend/static/css/cssNamespace.test.js 把關。
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AppShell from './AppShell';
import { apiPost } from '../utils/apiClient';

// jsdom 沒有 canvas，真實的 lottie-web 在 import 當下就會丟例外，與本測試要驗證的流程無關
vi.mock('lottie-web', () => ({ default: { loadAnimation: vi.fn(() => ({ destroy: vi.fn(), addEventListener: vi.fn() })) } }));
vi.mock('./route', () => ({ default: () => <div>頁面內容</div> }));
vi.mock('../components/ui/Footer', () => ({ default: () => null }));
vi.mock('../utils/apiClient', () => ({ apiPost: vi.fn() }));
vi.mock('./userServives/uploadDb', () => ({
  getUserSituation: vi.fn().mockResolvedValue({ level: 'beginner' }),
  addCalendarEvent: vi.fn(),
  addCalendarEvents: vi.fn(),
}));
vi.mock('./userServives/userServive', () => ({ signOut: vi.fn() }));
vi.mock('./userServives/authContext', () => ({
  useAuth: () => ({
    userData: {
      firestoreData: { name: '測試使用者', user_errors: {}, quiz_model: { type_stats: {} } },
    },
  }),
}));

function renderApp() {
  return render(
    <MemoryRouter>
      <AppShell />
    </MemoryRouter>,
  );
}

async function openBotFromSidebar(user) {
  // 桌面版與行動版各有一顆開啟個人選單的按鈕，取第一個
  await user.click(screen.getAllByRole('button', { name: '開啟個人資料選單' })[0]);
  const sidebar = document.querySelector('.sidebar.open');
  await user.click(within(sidebar).getByText('AI 助手'));
}

describe('從側邊欄開啟 AI 助手（真實元件整合）', () => {
  beforeEach(() => {
    apiPost.mockReset();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  test('點「AI 助手」會開啟聊天室，頁面內容仍在，並關閉個人選單與其遮罩', async () => {
    const user = userEvent.setup();
    renderApp();

    await openBotFromSidebar(user);

    // 第一次開啟要 lazy 載入 bot 的 chunk，給比預設 1 秒更寬鬆的等待時間
    expect(await screen.findByRole('dialog', { name: '族語 AI 助手' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('頁面內容')).toBeInTheDocument();
    // 個人選單點完會自己關閉，不該留下擋住畫面的遮罩
    expect(document.querySelector('.navbar-overlay')).not.toBeInTheDocument();
  });

  test('聊天室的外層使用專屬 class，不與其他遮罩共用 .overlay', async () => {
    const user = userEvent.setup();
    renderApp();
    await openBotFromSidebar(user);
    await screen.findByRole('dialog', { name: '族語 AI 助手' });

    expect(document.querySelector('.bot-overlay')).toBeInTheDocument();
    expect(document.querySelector('.overlay')).not.toBeInTheDocument();
  });

  test('可以送出訊息並收到回應，之後按返回能關閉，且不殘留遮罩', async () => {
    apiPost.mockResolvedValue({ message: '你好，我是助手回應' });
    const user = userEvent.setup();
    renderApp();
    await openBotFromSidebar(user);

    await user.type(await screen.findByLabelText('輸入訊息'), '你好{Enter}');
    expect(await screen.findByText('你好，我是助手回應')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.querySelector('.bot-overlay')).not.toBeInTheDocument();
    expect(screen.getByText('頁面內容')).toBeInTheDocument();
  });

  test('後端失敗時聊天室顯示錯誤訊息，畫面不會崩潰', async () => {
    apiPost.mockRejectedValue(new Error('network down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    renderApp();
    await openBotFromSidebar(user);

    await user.type(await screen.findByLabelText('輸入訊息'), '你好{Enter}');

    expect(await screen.findByText(/無法取得回應/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '族語 AI 助手' })).toBeInTheDocument();
  });
});
