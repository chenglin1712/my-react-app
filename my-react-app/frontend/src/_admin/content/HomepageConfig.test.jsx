import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomepageConfig from './HomepageConfig';
import { apiGet, apiPatch } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
}));

let mockRole = 'owner';
vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <HomepageConfig />
    </MemoryRouter>,
  );
}

const baseConfig = {
  hero_image_url: '', hero_link_url: '', hero_title_override: '',
  show_news_section: true, show_calendar_section: true, news_display_count: 6,
  button1_enabled: true, button2_enabled: true, button3_enabled: true,
  updated_by: 'owner-uid', updated_at: '2026-08-01T00:00:00Z',
};

describe('HomepageConfig', () => {
  beforeEach(() => {
    mockRole = 'owner';
    apiGet.mockReset();
    apiPatch.mockReset();
    apiGet.mockResolvedValue(baseConfig);
  });

  test('載入後帶入目前設定值', async () => {
    renderPage();
    expect(await screen.findByLabelText('顯示最新消息區塊')).toBeChecked();
    expect(screen.getByLabelText('最新消息顯示筆數')).toHaveValue(6);
  });

  test('三張功能卡片開關都能透過各自的 label 正確找到（驗證 id 沒有衝突）', async () => {
    renderPage();
    expect(await screen.findByLabelText('功能卡片 1：影像辨識')).toBeChecked();
    expect(screen.getByLabelText('功能卡片 2：詞彙遊戲')).toBeChecked();
    expect(screen.getByLabelText('功能卡片 3：測驗學習')).toBeChecked();
  });

  test('owner 看得到並可以送出儲存設定', async () => {
    apiPatch.mockResolvedValueOnce({ ...baseConfig, show_news_section: false });
    renderPage();
    await screen.findByLabelText('顯示最新消息區塊');
    fireEvent.click(screen.getByLabelText('顯示最新消息區塊'));
    fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        '/adminapi/homepage-config/',
        expect.objectContaining({ show_news_section: false }),
      );
    });
    expect(await screen.findByText('首頁顯示設定已儲存')).toBeInTheDocument();
  });

  test('editor 看得到目前設定但所有欄位唯讀，看不到儲存按鈕', async () => {
    mockRole = 'editor';
    renderPage();
    expect(await screen.findByLabelText('顯示最新消息區塊')).toBeDisabled();
    expect(screen.getByText(/只有擁有者或管理員可以變更並儲存/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /儲存設定/ })).not.toBeInTheDocument();
  });

  test('reviewer／analyst 一樣是唯讀視圖', async () => {
    mockRole = 'analyst';
    renderPage();
    expect(await screen.findByLabelText('主視覺標題覆寫')).toBeDisabled();
  });

  test('儲存失敗時顯示後端回傳的錯誤訊息', async () => {
    apiPatch.mockRejectedValueOnce(new Error('消息顯示筆數必須介於 1 到 20 之間'));
    renderPage();
    await screen.findByLabelText('顯示最新消息區塊');
    fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));
    expect(await screen.findByText('消息顯示筆數必須介於 1 到 20 之間')).toBeInTheDocument();
  });

  test('載入設定失敗時顯示錯誤訊息', async () => {
    apiGet.mockReset();
    apiGet.mockRejectedValueOnce(new Error('伺服器錯誤，請稍後再試'));
    renderPage();
    expect(await screen.findByText('伺服器錯誤，請稍後再試')).toBeInTheDocument();
  });
});
