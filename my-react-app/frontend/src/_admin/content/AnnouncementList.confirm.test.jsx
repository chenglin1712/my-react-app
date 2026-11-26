import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AnnouncementList from './AnnouncementList';
import { apiGet, apiPost, apiDelete } from '../../../utils/apiClient';
import { getRowAction } from '../testing/rowActions';
import { setAutoConfirm } from '../testing/autoConfirmForTests';

// 這個檔案專門驗證「會立刻影響前台的動作要先確認」（稽核 FE7b-02）與對話框內的錯誤顯示（FE7b-01、FE7b-13），
// 所以用真正的確認對話框（setAutoConfirm(false)）；獨立成一支檔案，是因為確認對話框的「同一時間只開一個」是模組層級狀態，
// 與其他測試共用同一個檔案時，前面測試殘留的視窗會讓這裡的判斷失準。
vi.mock('@components/ui/ConfirmDialog', async (importOriginal) => {
  const { withAutoConfirmedTransitions } = await import('../testing/autoConfirmForTests');
  return withAutoConfirmedTransitions(await importOriginal());
});
vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

let mockRole = 'owner';
vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

const pendingItem = {
  id: 2, title: '待審公告', category: 'exam', tribes: ['tayal'], status: 'pending_review',
  is_pinned: true, pin_until: '2026-09-01', created_by: 'editor-uid', updated_at: '2026-08-01T00:00:00Z',
};
const publishedItem = {
  id: 3, title: '已發布公告', category: 'activity', tribes: [], status: 'published',
  is_pinned: false, pin_until: null, created_by: 'editor-uid', updated_at: '2026-08-02T00:00:00Z',
  has_pending_revision: false,
};

function renderList() {
  return render(
    <MemoryRouter>
      <AnnouncementList />
    </MemoryRouter>,
  );
}

describe('AnnouncementList · 確認對話框與對話框內錯誤', () => {
  beforeEach(() => {
    mockRole = 'owner';
    apiGet.mockReset();
    apiPost.mockReset();
    apiDelete.mockReset();
    apiGet.mockResolvedValue({ results: [pendingItem, publishedItem], count: 2, page: 1, page_size: 10 });
  });
  afterEach(() => { setAutoConfirm(true); });

  /** 稽核 FE7b-02：已發布列的主要按鈕改為「編輯」，下架收進選單；核准、下架會先說明影響並確認。 */
  test('已發布的列：外露的主要按鈕是編輯，下架在「更多操作」選單裡', async () => {
    renderList();
    const row = (await screen.findByText('已發布公告')).closest('tr');
    expect(within(row).getByRole('button', { name: /編輯/ })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /^下架$/ })).not.toBeInTheDocument();
    expect(getRowAction(row, /下架/)).toBeInTheDocument();
  });

  test('核准前先確認：按取消不會送出請求；按確認才送出', async () => {
    setAutoConfirm(false);
    apiPost.mockResolvedValue({});
    renderList();
    const row = (await screen.findByText('待審公告')).closest('tr');

    fireEvent.click(getRowAction(row, /^核准$/));
    let dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('立即發布');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiPost).not.toHaveBeenCalled();

    fireEvent.click(getRowAction(row, /^核准$/));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '核准並發布' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/adminapi/announcements/2/approve/', { review_comment: '', base_updated_at: '2026-08-01T00:00:00Z' },
    ));
  });

  test('下架前先確認，說明會立即從前台移除；取消就不送出', async () => {
    setAutoConfirm(false);
    renderList();
    const row = (await screen.findByText('已發布公告')).closest('tr');

    fireEvent.click(getRowAction(row, /下架/));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('「已發布公告」');
    expect(dialog).toHaveTextContent('立即從前台移除');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiPost).not.toHaveBeenCalled();
  });

  /** 稽核 FE7b-13、FE7b-01 */
  test('退件對話框：剛打開不標紅色必填；失敗的錯誤顯示在對話框裡，理由保留', async () => {
    apiPost.mockRejectedValueOnce(Object.assign(new Error('請求參數錯誤'), {
      data: { errors: { review_comment: ['退件理由不可只有空白'] } },
    }));
    renderList();
    const row = (await screen.findByText('待審公告')).closest('tr');
    fireEvent.click(getRowAction(row, /退件/));

    const textbox = await screen.findByLabelText('請說明需要修改的內容');
    expect(textbox).not.toHaveClass('is-invalid');
    expect(screen.queryByRole('button', { name: /close/i })).toBeInTheDocument();

    fireEvent.blur(textbox);
    expect(textbox).toHaveClass('is-invalid');

    fireEvent.change(textbox, { target: { value: '請修改' } });
    fireEvent.click(screen.getByRole('button', { name: '確認退件' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('退件理由不可只有空白');
    expect(screen.getByLabelText('請說明需要修改的內容')).toHaveValue('請修改');
  });

  /** 稽核 FE7b-09 */
  test('停在第 2 頁、這一頁被清空時，自動退回前一頁而不是停在空白頁', async () => {
    const pageOne = { results: [pendingItem], count: 11, page: 1, page_size: 10 };
    apiGet.mockImplementation((url) => {
      if (url.includes('page=2')) return Promise.resolve({ results: [publishedItem], count: 11, page: 2, page_size: 10 });
      return Promise.resolve(pageOne);
    });
    renderList();
    await screen.findByText('待審公告');
    fireEvent.click(screen.getByRole('button', { name: /下一頁/ }));
    await screen.findByText('已發布公告');

    // 第 2 頁那一筆被別人處理掉：重新載入第 2 頁回來是空的，總數剩 10 筆（只有 1 頁）
    apiGet.mockImplementation((url) => {
      if (url.includes('page=2')) return Promise.resolve({ results: [], count: 10, page: 2, page_size: 10 });
      return Promise.resolve({ results: [pendingItem], count: 10, page: 1, page_size: 10 });
    });
    apiPost.mockResolvedValue({});
    setAutoConfirm(true);
    const row = screen.getByText('已發布公告').closest('tr');
    fireEvent.click(getRowAction(row, /下架/));

    expect(await screen.findByText('待審公告')).toBeInTheDocument();
    expect(screen.queryByText('沒有符合條件的公告')).not.toBeInTheDocument();
  });

  /** WP-8 追加：退頁重查期間要一直顯示載入中，不能先露出空白頁或舊資料 */
  test('退回前一頁重查期間持續顯示載入中，且以每頁 10 筆計算退回的頁數', async () => {
    apiGet.mockImplementation((url) => {
      if (url.includes('page=2')) return Promise.resolve({ results: [publishedItem], count: 11, page: 2, page_size: 10 });
      return Promise.resolve({ results: [pendingItem], count: 11, page: 1, page_size: 10 });
    });
    renderList();
    await screen.findByText('待審公告');
    fireEvent.click(screen.getByRole('button', { name: /下一頁/ }));
    await screen.findByText('已發布公告');

    // 第 2 頁清空後退回第 1 頁；第 1 頁的重查刻意卡住，觀察期間的畫面
    let resolvePageOne;
    apiPost.mockResolvedValue({});
    apiGet.mockImplementation((url) => {
      if (url.includes('page=2')) return Promise.resolve({ results: [], count: 10, page: 2, page_size: 10 });
      return new Promise((resolve) => { resolvePageOne = resolve; });
    });
    setAutoConfirm(true);
    const row = screen.getByText('已發布公告').closest('tr');
    fireEvent.click(getRowAction(row, /下架/));

    await waitFor(() => expect(resolvePageOne).toBeDefined());
    expect(screen.getByText('載入公告中…')).toBeInTheDocument();
    expect(screen.queryByText('沒有符合條件的公告')).not.toBeInTheDocument();
    expect(apiGet).toHaveBeenLastCalledWith(expect.stringContaining('page=1'));
    expect(apiGet).toHaveBeenLastCalledWith(expect.stringContaining('page_size=10'));

    resolvePageOne({ results: [pendingItem], count: 10, page: 1, page_size: 10 });
    expect(await screen.findByText('待審公告')).toBeInTheDocument();
    expect(screen.queryByText('載入公告中…')).not.toBeInTheDocument();
  });
});
