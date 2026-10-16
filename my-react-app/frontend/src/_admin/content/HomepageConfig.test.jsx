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
  marquee_items: ['第一則', '第二則'], show_marquee: true,
  tagline: '標語', show_tagline: true,
  quote_text: '', show_quote: true,
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

  test('分成宣傳區、跑馬燈與標語、顯示開關三區，認證公告開關用清楚名稱', async () => {
    renderPage();
    await screen.findByLabelText('顯示最新消息區塊');
    expect(screen.getByRole('heading', { name: '宣傳區' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '跑馬燈與標語' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '顯示開關' })).toBeInTheDocument();
    expect(screen.getByLabelText('顯示族語認證最新公告區塊')).toBeChecked();
    expect(screen.queryByLabelText('顯示考試日曆區塊')).not.toBeInTheDocument();
  });

  test('跑馬燈清單帶入成一行一則，儲存時整理成清單並去掉空行與空白', async () => {
    apiPatch.mockResolvedValueOnce(baseConfig);
    renderPage();
    const box = await screen.findByLabelText('跑馬燈內容');
    expect(box).toHaveValue(['第一則', '第二則'].join('\n'));
    fireEvent.change(box, { target: { value: ['  甲  ', '', '乙', ''].join('\n') } });
    fireEvent.change(screen.getByLabelText('標語'), { target: { value: '  新標語 ' } });
    fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch.mock.calls[0][1]).toEqual(expect.objectContaining({
      marquee_items: ['甲', '乙'], tagline: '新標語', show_marquee: true,
    }));
  });

  test('跑馬燈超過 10 則或單則過長，欄位旁顯示錯誤且不送出', async () => {
    renderPage();
    const box = await screen.findByLabelText('跑馬燈內容');
    fireEvent.change(box, { target: { value: Array.from({ length: 11 }, (_, i) => `項${i}`).join('\n') } });
    fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));
    expect(await screen.findByText('最多 10 則，目前有 11 則')).toBeInTheDocument();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(box, { target: { value: '字'.repeat(41) } });
    expect(await screen.findByText('第 1 則超過 40 字，請縮短')).toBeInTheDocument();
    expect(apiPatch).not.toHaveBeenCalled();
  });

  test('標語與引言超過字數上限時不送出', async () => {
    renderPage();
    await screen.findByLabelText('標語');
    fireEvent.change(screen.getByLabelText('標語'), { target: { value: '字'.repeat(61) } });
    fireEvent.change(screen.getByLabelText('報頭引言'), { target: { value: '字'.repeat(121) } });
    fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));
    expect(await screen.findByText('標語最多 60 字')).toBeInTheDocument();
    expect(screen.getByText('引言最多 120 字')).toBeInTheDocument();
    expect(apiPatch).not.toHaveBeenCalled();
  });

  test('三個文字開關可獨立切換並送出', async () => {
    apiPatch.mockResolvedValueOnce(baseConfig);
    renderPage();
    fireEvent.click(await screen.findByLabelText('顯示跑馬燈'));
    fireEvent.click(screen.getByLabelText('顯示標語'));
    fireEvent.click(screen.getByLabelText('顯示報頭引言'));
    fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch.mock.calls[0][1]).toEqual(expect.objectContaining({
      show_marquee: false, show_tagline: false, show_quote: false,
    }));
  });

  test('後端回應漏帶新欄位時，表單保留原本的值', async () => {
    const { marquee_items: _m, tagline: _t, ...legacy } = baseConfig;
    apiGet.mockResolvedValueOnce(legacy);
    renderPage();
    expect(await screen.findByLabelText('跑馬燈內容')).toHaveValue('');
    expect(screen.getByLabelText('標語')).toHaveValue('');
  });

  test('唯讀角色看得到跑馬燈欄位但不能編輯', async () => {
    mockRole = 'editor';
    renderPage();
    expect(await screen.findByLabelText('跑馬燈內容')).toBeDisabled();
    expect(screen.getByLabelText('顯示跑馬燈')).toBeDisabled();
  });

  test('修正欄位後驗證摘要立即消失，送出失敗時焦點移到第一個無效欄位', async () => {
    renderPage();
    const box = await screen.findByLabelText('跑馬燈內容');
    fireEvent.change(box, { target: { value: '字'.repeat(41) } });
    fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));
    expect(await screen.findByText('有欄位需要修正，請看標示的欄位')).toBeInTheDocument();
    await waitFor(() => expect(box).toHaveFocus());
    expect(box.getAttribute('aria-describedby')).toContain('homepage-marquee-items-error');
    fireEvent.change(box, { target: { value: '短' } });
    expect(screen.queryByText('有欄位需要修正，請看標示的欄位')).not.toBeInTheDocument();
    expect(box.getAttribute('aria-describedby')).not.toContain('-error');
  });

  test('儲存進行中又編輯的欄位，不會被回應蓋掉', async () => {
    let finish;
    apiPatch.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    renderPage();
    fireEvent.click(await screen.findByLabelText('顯示族語認證最新公告區塊'));
    fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('標語'), { target: { value: '儲存中才打的字' } });
    finish({ ...baseConfig, show_calendar_section: false });
    expect(await screen.findByText('首頁顯示設定已儲存')).toBeInTheDocument();
    expect(screen.getByLabelText('標語')).toHaveValue('儲存中才打的字');
  });

  test('全頁的欄位與說明 id 不重複', async () => {
    const { container } = renderPage();
    await screen.findByLabelText('跑馬燈內容');
    const ids = [...container.querySelectorAll('[id]')].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
