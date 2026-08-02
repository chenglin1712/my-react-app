import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AnnouncementEditor from './AnnouncementEditor';
import { apiGet, apiPost, apiPatch } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
}));

let mockRole = 'owner';
vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

function renderNew() {
  return render(
    <MemoryRouter initialEntries={['/admin/content/announcements/new']}>
      <Routes>
        <Route path="/admin/content/announcements/new" element={<AnnouncementEditor />} />
        <Route path="/admin/content/announcements/:id" element={<AnnouncementEditor />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderEdit(id) {
  return render(
    <MemoryRouter initialEntries={[`/admin/content/announcements/${id}`]}>
      <Routes>
        <Route path="/admin/content/announcements/:id" element={<AnnouncementEditor />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AnnouncementEditor · 新增模式', () => {
  beforeEach(() => {
    mockRole = 'owner';
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
  });

  // 這兩個驗證用「儲存並送審」（type="button"，直接呼叫 save(true)）觸發，
  // 不是用「儲存」那顆 type="submit" 按鈕：標題欄位本身有 HTML5 的 required
  // 屬性，瀏覽器（含 jsdom）在表單送出當下就會先攔截、跳出瀏覽器原生的
  // 驗證提示，事件根本不會傳到 React 的 onSubmit，元件裡的自訂檢查永遠不會
  // 執行到——這是這個專案既有表單（loginForm／registerForm）本來就有的
  // 慣例（required 屬性 + 瀏覽器原生驗證，沒有額外用 noValidate 蓋掉），
  // 這裡沒有理由破例。用不會觸發表單送出流程的按鈕測，才是真的在測到
  // 元件自己的 JS 驗證邏輯。
  test('標題空白時擋下送出，不呼叫 API', async () => {
    renderNew();
    fireEvent.click(screen.getByRole('button', { name: /儲存並送審/ }));
    expect(await screen.findByText('標題為必填')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  test('開啟置頂但沒填到期日時擋下送出', async () => {
    renderNew();
    fireEvent.change(screen.getByLabelText(/標題/), { target: { value: '測試公告' } });
    // react-bootstrap 的 Form.Check type="switch" 只是套用不同 CSS 樣式的
    // checkbox，底層 <input type="checkbox"> 沒有 role="switch"，可及性
    // 角色仍然是 checkbox。
    fireEvent.click(screen.getByRole('checkbox', { name: '置頂公告' }));
    fireEvent.click(screen.getByRole('button', { name: /儲存並送審/ }));
    expect(await screen.findByText('開啟置頂時，置頂到期日為必填')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  test('排程發布時間會轉成帶時區的 ISO 字串再送出（不能是沒有時區的原始字串）', async () => {
    // 回歸測試：datetime-local 的值（例如 "2026-08-15T14:30"）沒有時區資訊，
    // 直接送給後端會被當成 UTC，造成使用者設定的時間整個偏移。
    apiPost.mockResolvedValueOnce({ id: 99, status: 'draft' });
    renderNew();
    fireEvent.change(screen.getByLabelText(/標題/), { target: { value: '排程測試' } });
    fireEvent.change(screen.getByLabelText('排程發布時間'), { target: { value: '2026-08-15T14:30' } });
    fireEvent.click(screen.getByRole('button', { name: /儲存$/ }));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const [, payload] = apiPost.mock.calls[0];
    expect(payload.publish_at).toMatch(/Z$/);
    expect(payload.publish_at).not.toBe('2026-08-15T14:30');
    // 轉換後應該能還原回同一個時間點（不是隨便一個帶 Z 的字串）。
    expect(new Date(payload.publish_at).getTime()).toBe(new Date('2026-08-15T14:30').getTime());
  });

  test('沒填排程時間時送出 null，而不是空字串', async () => {
    apiPost.mockResolvedValueOnce({ id: 99, status: 'draft' });
    renderNew();
    fireEvent.change(screen.getByLabelText(/標題/), { target: { value: '沒有排程' } });
    fireEvent.click(screen.getByRole('button', { name: /儲存$/ }));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const [, payload] = apiPost.mock.calls[0];
    expect(payload.publish_at).toBeNull();
    expect(payload.unpublish_at).toBeNull();
  });

  test('「儲存並送審」會先建立再呼叫 submit 端點', async () => {
    apiPost.mockImplementation((url) => {
      if (url === '/adminapi/announcements/') return Promise.resolve({ id: 42, status: 'draft' });
      if (url === '/adminapi/announcements/42/submit/') return Promise.resolve({ status: 'pending_review' });
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    renderNew();
    fireEvent.change(screen.getByLabelText(/標題/), { target: { value: '要送審的公告' } });
    fireEvent.click(screen.getByRole('button', { name: /儲存並送審/ }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/adminapi/announcements/42/submit/');
    });
    expect(await screen.findByText('已儲存並送審')).toBeInTheDocument();
  });
});

describe('AnnouncementEditor · 編輯模式', () => {
  beforeEach(() => {
    mockRole = 'owner';
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
  });

  test('載入現有公告資料並帶入表單', async () => {
    apiGet.mockResolvedValueOnce({
      id: 7, title: '既有公告', body: '內文', category: 'exam', tribes: ['tayal'],
      cover_image_url: '', link_url: '', is_pinned: false, pin_until: null,
      publish_at: null, unpublish_at: null, status: 'draft',
    });
    renderEdit(7);
    expect(await screen.findByDisplayValue('既有公告')).toBeInTheDocument();
    expect(screen.getByDisplayValue('內文')).toBeInTheDocument();
  });

  test('狀態是 pending_review 時全部欄位唯讀，且看不到儲存按鈕', async () => {
    apiGet.mockResolvedValueOnce({
      id: 8, title: '送審中的公告', body: '', category: 'announcement', tribes: [],
      cover_image_url: '', link_url: '', is_pinned: false, pin_until: null,
      publish_at: null, unpublish_at: null, status: 'pending_review',
    });
    renderEdit(8);
    expect(await screen.findByDisplayValue('送審中的公告')).toBeDisabled();
    expect(screen.getByText(/送審中的公告請先撤回/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /儲存$/ })).not.toBeInTheDocument();
  });

  test('編輯時儲存呼叫 PATCH 而不是 POST', async () => {
    apiGet.mockResolvedValueOnce({
      id: 9, title: '可編輯的草稿', body: '', category: 'announcement', tribes: [],
      cover_image_url: '', link_url: '', is_pinned: false, pin_until: null,
      publish_at: null, unpublish_at: null, status: 'draft',
    });
    apiPatch.mockResolvedValueOnce({ status: 'draft' });
    renderEdit(9);
    await screen.findByDisplayValue('可編輯的草稿');
    fireEvent.click(screen.getByRole('button', { name: /儲存$/ }));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith('/adminapi/announcements/9/', expect.any(Object));
    });
    expect(apiPost).not.toHaveBeenCalled();
  });

  test('置頂到期日（純日期欄位）載入後不會因時區換算跨日', async () => {
    // 回歸測試：toLocalInput 的 date-only 分支過去會把 "2026-09-01" 丟進
    // new Date() 當 UTC 午夜解析，再用本地時區換算——在 UTC 負偏移地區
    // 會變成 "2026-08-31"。這裡驗證欄位值原樣是 "2026-09-01"，不依賴
    // 測試環境的時區設定（因為根本不該經過任何時區換算）。
    apiGet.mockResolvedValueOnce({
      id: 12, title: '置頂公告', body: '', category: 'announcement', tribes: [],
      cover_image_url: '', link_url: '', is_pinned: true, pin_until: '2026-09-01',
      publish_at: null, unpublish_at: null, status: 'draft',
    });
    renderEdit(12);
    await screen.findByDisplayValue('置頂公告');
    expect(screen.getByLabelText(/置頂到期日/)).toHaveValue('2026-09-01');
  });

  test('已下架的公告可以編輯（視同重新起草）', async () => {
    apiGet.mockResolvedValueOnce({
      id: 10, title: '已下架的公告', body: '', category: 'announcement', tribes: [],
      cover_image_url: '', link_url: '', is_pinned: false, pin_until: null,
      publish_at: null, unpublish_at: null, status: 'unpublished',
    });
    renderEdit(10);
    expect(await screen.findByDisplayValue('已下架的公告')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /儲存$/ })).toBeInTheDocument();
  });

  test('reviewer 檢視草稿：狀態允許編輯，但角色不是內容編輯者，欄位仍唯讀', async () => {
    // 回歸測試：editable 過去只看狀態不看角色，reviewer／analyst 會在
    // draft／rejected／unpublished 狀態下看到看起來可以存檔的表單，實際
    // 送出會被後端 require_role(CONTENT_EDITORS) 擋成 403。
    mockRole = 'reviewer';
    apiGet.mockResolvedValueOnce({
      id: 11, title: '草稿內容', body: '', category: 'announcement', tribes: [],
      cover_image_url: '', link_url: '', is_pinned: false, pin_until: null,
      publish_at: null, unpublish_at: null, status: 'draft',
    });
    renderEdit(11);
    expect(await screen.findByDisplayValue('草稿內容')).toBeDisabled();
    expect(screen.getByText(/目前角色沒有內容編輯權限/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /儲存$/ })).not.toBeInTheDocument();
  });

  test('載入既有的 display_date_text 並帶入表單', async () => {
    apiGet.mockResolvedValueOnce({
      id: 13, title: '有日期文字的公告', body: '', category: 'activity', tribes: [],
      cover_image_url: '', link_url: '', is_pinned: false, pin_until: null,
      publish_at: null, unpublish_at: null, status: 'draft',
      display_date_text: '2026-08-01 ~ 2026-08-10', source: 'crawler',
    });
    renderEdit(13);
    expect(await screen.findByDisplayValue('2026-08-01 ~ 2026-08-10')).toBeInTheDocument();
  });

  test('編輯 display_date_text 後儲存，payload 帶上修改後的值', async () => {
    apiGet.mockResolvedValueOnce({
      id: 14, title: '待編輯日期文字', body: '', category: 'activity', tribes: [],
      cover_image_url: '', link_url: '', is_pinned: false, pin_until: null,
      publish_at: null, unpublish_at: null, status: 'draft',
      display_date_text: '', source: 'admin',
    });
    apiPatch.mockResolvedValueOnce({ status: 'draft' });
    renderEdit(14);
    await screen.findByDisplayValue('待編輯日期文字');
    fireEvent.change(screen.getByLabelText(/顯示日期文字/), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: /儲存$/ }));

    await waitFor(() => {
      const [, payload] = apiPatch.mock.calls[0];
      expect(payload.display_date_text).toBe('2026-09-01');
    });
  });

  test('source=crawler 時顯示「爬蟲匯入」提示', async () => {
    apiGet.mockResolvedValueOnce({
      id: 15, title: '爬蟲匯入的公告', body: '', category: 'activity', tribes: [],
      cover_image_url: '', link_url: '', is_pinned: false, pin_until: null,
      publish_at: null, unpublish_at: null, status: 'published',
      display_date_text: '', source: 'crawler',
    });
    renderEdit(15);
    expect(await screen.findByText('爬蟲匯入')).toBeInTheDocument();
  });

  test('source=admin 時不顯示「爬蟲匯入」提示', async () => {
    apiGet.mockResolvedValueOnce({
      id: 16, title: '後台自建的公告', body: '', category: 'announcement', tribes: [],
      cover_image_url: '', link_url: '', is_pinned: false, pin_until: null,
      publish_at: null, unpublish_at: null, status: 'draft',
      display_date_text: '', source: 'admin',
    });
    renderEdit(16);
    await screen.findByDisplayValue('後台自建的公告');
    expect(screen.queryByText('爬蟲匯入')).not.toBeInTheDocument();
  });

  test('新增公告模式不顯示「爬蟲匯入」提示（一定是後台自建）', () => {
    renderNew();
    expect(screen.queryByText('爬蟲匯入')).not.toBeInTheDocument();
  });
});
