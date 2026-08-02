import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from './Dashboard';
import { apiGet } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(),
}));

let mockRole = 'owner';
vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

describe('Dashboard', () => {
  beforeEach(() => {
    mockRole = 'owner';
    apiGet.mockReset();
    apiGet.mockImplementation((url) => {
      if (url.includes('/announcements/')) return Promise.resolve({ results: [], count: 5, page: 1, page_size: 1 });
      if (url.includes('/audit-log/')) {
        return Promise.resolve({
          results: [
            { id: 1, actor_uid: 'owner-uid', actor_role: 'owner', action: 'approve', target_type: 'announcement', target_id: '9', created_at: '2026-08-02T03:00:00Z' },
          ],
        });
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
  });

  test('待審公告卡片顯示真實數字（來自 API 的 count，不是寫死的值）', async () => {
    renderDashboard();
    expect(await screen.findByText('5')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('status=pending_review'));
  });

  test('尚未串接資料來源的統計卡與面板只顯示「即將推出」／開發中訊息，沒有任何虛構數字', async () => {
    renderDashboard();
    await screen.findByText('5');
    // 三張佔位卡片都要顯示「—」而不是任何看起來像真實統計的數字。
    expect(screen.getAllByText('即將推出').length).toBeGreaterThanOrEqual(3);
    // 「每日活躍與新註冊」跟「族語使用分布」兩個面板用的是同一句訊息文字。
    expect(screen.getAllByText('尚未串接資料來源，開發中')).toHaveLength(2);
    expect(screen.getByText('尚未串接健康檢查資料')).toBeInTheDocument();
  });

  test('owner 看得到「最近操作」面板，內容來自 audit-log API', async () => {
    renderDashboard();
    expect(await screen.findByText(/owner-uid/)).toBeInTheDocument();
    expect(screen.getByText(/核准/)).toBeInTheDocument();
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('/adminapi/audit-log/'));
    });
  });

  test('editor 看不到「最近操作」面板，也不會呼叫 audit-log API（該端點對 editor 一定回 403）', async () => {
    mockRole = 'editor';
    renderDashboard();
    await screen.findByText('5');
    expect(screen.queryByText('最近操作')).not.toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringContaining('/adminapi/audit-log/'));
  });

  test('待審公告 API 失敗時顯示錯誤文字，不會讓整個儀表板空白', async () => {
    apiGet.mockImplementation((url) => {
      if (url.includes('/announcements/')) return Promise.reject(new Error('伺服器錯誤，請稍後再試'));
      return Promise.resolve({ results: [] });
    });
    renderDashboard();
    expect(await screen.findByText('伺服器錯誤，請稍後再試')).toBeInTheDocument();
    expect(screen.getByText('儀表板')).toBeInTheDocument();
  });
});
