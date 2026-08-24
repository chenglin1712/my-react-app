import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AnnouncementList from './AnnouncementList';
import { apiGet, apiPost, apiDelete } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

let mockRole = 'owner';
vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

const draftItem = {
  id: 1, title: '草稿公告', category: 'announcement', tribes: [], status: 'draft',
  is_pinned: false, pin_until: null, created_by: 'editor-uid', updated_at: '2026-08-01T00:00:00Z',
};
const pendingItem = {
  id: 2, title: '待審公告', category: 'exam', tribes: ['tayal'], status: 'pending_review',
  is_pinned: true, pin_until: '2026-09-01', created_by: 'editor-uid', updated_at: '2026-08-01T00:00:00Z',
};
const publishedItem = {
  id: 3, title: '已發布公告', category: 'activity', tribes: [], status: 'published',
  is_pinned: false, pin_until: null, created_by: 'editor-uid', updated_at: '2026-08-02T00:00:00Z',
  has_pending_revision: false,
};

function renderList(initialEntries = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AnnouncementList />
    </MemoryRouter>,
  );
}

describe('AnnouncementList', () => {
  beforeEach(() => {
    mockRole = 'owner';
    apiGet.mockReset();
    apiPost.mockReset();
    apiDelete.mockReset();
    apiGet.mockResolvedValue({
      results: [draftItem, pendingItem],
      count: 2,
      page: 1,
      page_size: 10,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  test('載入後渲染公告列表，狀態與族語正確顯示', async () => {
    renderList();
    expect(await screen.findByText('草稿公告')).toBeInTheDocument();
    expect(screen.getByText('待審公告')).toBeInTheDocument();
    // tribes 為空陣列時顯示「全部族語」，而不是空白或錯誤字樣。篩選列的
    // <option>「全部族語」也會命中同樣的文字，所以只在表格範圍內找。
    const table = screen.getByRole('table');
    expect(within(table).getByText('全部族語')).toBeInTheDocument();
    expect(within(table).getByText('泰雅語')).toBeInTheDocument();
  });

  test('網址帶 ?status=pending_review 時，篩選列預選該狀態並用它查詢', async () => {
    // 回歸測試：儀表板的「待審公告」卡片連到這個網址帶 status query
    // param，如果元件掛載時沒讀網址、只用寫死的空字串當初始篩選，連結
    // 點過去會看起來像沒作用（進來的還是全部狀態的列表）。
    renderList(['/?status=pending_review']);
    await screen.findByText('待審公告');
    expect(screen.getByLabelText('狀態')).toHaveValue('pending_review');
    await waitFor(() => {
      const [url] = apiGet.mock.calls[0];
      expect(url).toContain('status=pending_review');
    });
  });

  test('置頂到期日（純日期欄位）顯示不會因時區換算跨日', async () => {
    // 回歸測試：formatDate 過去用 new Date("2026-09-01") 解析（UTC 午夜）
    // 再用本地時區格式化，在 UTC 負偏移地區會顯示成 2026/8/31。
    renderList();
    const row = await screen.findByText('待審公告').then((el) => el.closest('tr'));
    expect(within(row).getByText(/2026\/09\/01/)).toBeInTheDocument();
  });

  test('owner 檢視待審項目：核准／退件／撤回都看得到（後端 withdraw 對 CONTENT_EDITORS 全部開放，不是 editor 專屬）', async () => {
    // 回歸測試：後端 announcement_withdraw 用 require_role(CONTENT_EDITORS)，
    // 沒有限定只有 editor 能撤回——owner／admin 一樣能撤回任何一筆待審公告。
    // 過去前端只在 role === 'editor' 時顯示撤回按鈕，owner 明明呼叫得動這支
    // API 卻在畫面上完全看不到入口。
    renderList();
    await screen.findByText('待審公告');
    const row = screen.getByText('待審公告').closest('tr');
    expect(within(row).getByRole('button', { name: /核准/ })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /退件/ })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /撤回/ })).toBeInTheDocument();
  });

  test('editor 檢視待審項目：看得到撤回，看不到 PUBLISHERS 專屬的核准／退件', async () => {
    mockRole = 'editor';
    renderList();
    await screen.findByText('待審公告');
    const row = screen.getByText('待審公告').closest('tr');
    expect(within(row).getByRole('button', { name: /撤回/ })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /核准/ })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /退件/ })).not.toBeInTheDocument();
  });

  test('editor 檢視草稿項目：看得到編輯／送審，看不到刪除（刪除是 PUBLISHERS 專屬）', async () => {
    // 回歸測試：後端 _delete_announcement 用 require_role(PUBLISHERS)，
    // editor 點刪除一定拿到 403——過去前端用 CONTENT_EDITORS 判斷刪除
    // 按鈕的顯示，會讓 editor 看到一顆點下去必定失敗的按鈕。
    mockRole = 'editor';
    renderList();
    await screen.findByText('草稿公告');
    const row = screen.getByText('草稿公告').closest('tr');
    expect(within(row).getByRole('button', { name: /編輯/ })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /送審/ })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /刪除/ })).not.toBeInTheDocument();
  });

  test('published 狀態下 CONTENT_EDITORS 看得到編輯連結', async () => {
    mockRole = 'editor';
    apiGet.mockResolvedValue({
      results: [publishedItem],
      count: 1,
      page: 1,
      page_size: 10,
    });

    renderList();

    const row = await screen.findByText('已發布公告').then((el) => el.closest('tr'));
    const editLink = within(row).getByRole('button', { name: /編輯/ });

    expect(editLink).toBeInTheDocument();
    expect(editLink).toHaveAttribute(
      'href',
      '/admin/content/announcements/3',
    );
    expect(within(row).queryByRole('button', { name: /下架/ })).not.toBeInTheDocument();
  });

  test('published 狀態下編輯與下架按鈕可同時顯示，且下架仍為 PUBLISHERS 專屬', async () => {
    apiGet.mockResolvedValue({
      results: [publishedItem],
      count: 1,
      page: 1,
      page_size: 10,
    });

    renderList();

    const row = await screen.findByText('已發布公告').then((el) => el.closest('tr'));
    expect(within(row).getByRole('button', { name: /編輯/ })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /下架/ })).toBeInTheDocument();
  });

  test('has_pending_revision 為 true 時顯示提示、核准修改與退件修改按鈕，並呼叫各自端點', async () => {
    const itemWithRevision = {
      ...publishedItem,
      has_pending_revision: true,
    };

    apiGet.mockResolvedValue({
      results: [itemWithRevision],
      count: 1,
      page: 1,
      page_size: 10,
    });
    apiPost.mockResolvedValue({});

    renderList();

    let row = await screen.findByText('已發布公告').then((el) => el.closest('tr'));
    expect(within(row).getByText('有待審修改')).toBeInTheDocument();

    const approveButton = within(row).getByRole('button', { name: /核准修改/ });
    const rejectButton = within(row).getByRole('button', { name: /退件修改/ });

    expect(approveButton).toBeInTheDocument();
    expect(rejectButton).toBeInTheDocument();

    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/announcements/3/pending-revision/approve/',
        { review_comment: '' },
      );
    });

    // 核准後元件會重新載入列表；等操作狀態解除後，再測試退件修改流程。
    await waitFor(() => {
      row = screen.getByText('已發布公告').closest('tr');
      expect(
        within(row).getByRole('button', { name: /退件修改/ }),
      ).not.toBeDisabled();
    });

    fireEvent.click(within(row).getByRole('button', { name: /退件修改/ }));

    expect(await screen.findByText('退件修改原因')).toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: '確認退件' });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(
      screen.getByLabelText('請說明需要修改的內容'),
      { target: { value: '新內容的用字需要調整' } },
    );
    expect(confirmButton).not.toBeDisabled();

    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/announcements/3/pending-revision/reject/',
        { review_comment: '新內容的用字需要調整' },
      );
    });
  });

  test('editor 看得到待審修改提示與編輯，但看不到 PUBLISHERS 專屬的核准修改／退件修改', async () => {
    mockRole = 'editor';
    apiGet.mockResolvedValue({
      results: [{ ...publishedItem, has_pending_revision: true }],
      count: 1,
      page: 1,
      page_size: 10,
    });

    renderList();

    const row = await screen.findByText('已發布公告').then((el) => el.closest('tr'));
    expect(within(row).getByText('有待審修改')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /編輯/ })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /核准修改/ })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /退件修改/ })).not.toBeInTheDocument();
  });

  test('reviewer 看不到「新增公告」入口，owner 看得到', async () => {
    mockRole = 'reviewer';
    const { unmount } = renderList();
    await screen.findByText('草稿公告');
    expect(screen.queryByRole('button', { name: /新增公告/ })).not.toBeInTheDocument();
    unmount();

    mockRole = 'owner';
    renderList();
    await screen.findByText('草稿公告');
    expect(screen.getByRole('button', { name: /新增公告/ })).toBeInTheDocument();
  });

  test('reviewer 對任何項目都沒有狀態操作按鈕，只有檢視', async () => {
    mockRole = 'reviewer';
    renderList();
    await screen.findByText('草稿公告');
    const row = screen.getByText('草稿公告').closest('tr');
    // react-bootstrap 的 Button as={Link} 渲染成 <a role="button">（樣式是按鈕，
    // 語意上仍是可點擊按鈕），不是 role="link"。
    expect(within(row).getByRole('button', { name: /檢視/ })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /編輯|送審|刪除/ })).not.toBeInTheDocument();
  });

  test('退件必須填寫理由才能送出，送出後呼叫 reject 端點並帶上理由', async () => {
    apiPost.mockResolvedValue({});
    renderList();
    await screen.findByText('待審公告');
    const row = screen.getByText('待審公告').closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: /退件/ }));

    const confirmBtn = await screen.findByRole('button', { name: '確認退件' });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(
      screen.getByLabelText('請說明需要修改的內容'),
      { target: { value: '用字需要再確認' } },
    );
    expect(confirmBtn).not.toBeDisabled();

    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/announcements/2/reject/',
        { review_comment: '用字需要再確認' },
      );
    });
  });

  /** 回歸測試：runAction() 原本吞掉錯誤只設定 error state，沒有回傳值，
   * submitReject() 不管成功失敗都會接著關閉 Modal——退件失敗時，使用者
   * 剛打的理由整段消失，只在頁面上方留一行錯誤訊息，跟 useReviewableContentCrud
   * 已經修過的同一類問題。 */
  test('退件失敗時 Modal 不會關閉，理由文字保留讓使用者可以直接重試', async () => {
    apiPost.mockRejectedValueOnce(new Error('伺服器暫時無法處理，請稍後再試'));
    renderList();
    await screen.findByText('待審公告');
    const row = screen.getByText('待審公告').closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: /退件/ }));

    fireEvent.change(
      screen.getByLabelText('請說明需要修改的內容'),
      { target: { value: '用字需要再確認' } },
    );
    fireEvent.click(screen.getByRole('button', { name: '確認退件' }));

    expect(await screen.findByText('伺服器暫時無法處理，請稍後再試')).toBeInTheDocument();
    expect(screen.getByText('退件原因')).toBeInTheDocument();
    expect(screen.getByLabelText('請說明需要修改的內容')).toHaveValue('用字需要再確認');
  });

  /** 回歸測試：連續換頁或連續搜尋時，較舊的查詢若比較新的查詢晚回來，
   * 不能覆蓋新查詢的結果（跟 WordList.jsx／GrammarTree.jsx 那類問題一樣）。 */
  test('較舊的搜尋晚回來時，不會覆蓋掉後送出的新搜尋結果', async () => {
    renderList();
    await screen.findByText('草稿公告');

    let resolveFirstSearch;
    apiGet.mockImplementation((url) => {
      if (url.includes('keyword=first')) {
        return new Promise((resolve) => { resolveFirstSearch = resolve; });
      }
      return Promise.resolve({
        results: [pendingItem],
        count: 1,
        page: 1,
        page_size: 10,
      });
    });

    fireEvent.change(screen.getByLabelText('關鍵字搜尋'), { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(
      expect.stringContaining('keyword=first'),
    ));

    fireEvent.change(screen.getByLabelText('關鍵字搜尋'), { target: { value: 'second' } });
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }));
    expect(await screen.findByText('待審公告')).toBeInTheDocument();

    resolveFirstSearch({
      results: [draftItem], count: 1, page: 1, page_size: 10,
    });
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(screen.getByText('待審公告')).toBeInTheDocument();
    expect(screen.queryByText('草稿公告')).not.toBeInTheDocument();
  });

  test('刪除草稿前會跳原生確認框，確認後呼叫 apiDelete', async () => {
    apiDelete.mockResolvedValue({});
    renderList();
    await screen.findByText('草稿公告');
    const row = screen.getByText('草稿公告').closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: /刪除/ }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(apiDelete).toHaveBeenCalledWith('/adminapi/announcements/1/');
    });
  });

  test('apiGet 失敗時顯示錯誤訊息而不是讓畫面整個空白', async () => {
    apiGet.mockRejectedValueOnce(new Error('伺服器錯誤，請稍後再試'));
    renderList();
    expect(await screen.findByText('伺服器錯誤，請稍後再試')).toBeInTheDocument();
  });
});

describe('AnnouncementList · 爬蟲同步', () => {
  const syncStatusResponse = {
    status: {
      last_success_at: '2026-08-02T15:46:40Z',
      last_failure_at: null,
      last_failure_reason: '',
      consecutive_failures: 0,
      last_imported_count: 6,
      last_skipped_count: 0,
    },
  };

  beforeEach(() => {
    mockRole = 'owner';
    apiGet.mockReset();
    apiPost.mockReset();
    apiDelete.mockReset();
    // 列表查詢跟同步狀態查詢都打 apiGet，用網址字串分流回應，而不是像
    // 其他測試那樣直接 mockResolvedValue 同一個形狀給所有呼叫。
    apiGet.mockImplementation((url) => {
      if (url.includes('sync-crawler')) return Promise.resolve(syncStatusResponse);
      return Promise.resolve({
        results: [draftItem, pendingItem],
        count: 2,
        page: 1,
        page_size: 10,
      });
    });
  });

  test('reviewer 看不到同步按鈕，也不會打同步狀態查詢', async () => {
    mockRole = 'reviewer';
    renderList();
    await screen.findByText('草稿公告');
    expect(screen.queryByRole('button', { name: /同步爬蟲活動/ })).not.toBeInTheDocument();
    expect(apiGet.mock.calls.some(([url]) => url.includes('sync-crawler'))).toBe(false);
  });

  test('owner 看得到同步按鈕，並顯示上次同步時間與筆數', async () => {
    renderList();
    expect(await screen.findByRole('button', { name: /同步爬蟲活動/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/上次同步/).textContent).toContain('新增 6 筆、略過 0 筆');
    });
  });

  test('從未同步過時顯示「尚未同步過」', async () => {
    apiGet.mockImplementation((url) => {
      if (url.includes('sync-crawler')) {
        return Promise.resolve({
          status: {
            last_success_at: null,
            consecutive_failures: 0,
          },
        });
      }
      return Promise.resolve({
        results: [],
        count: 0,
        page: 1,
        page_size: 10,
      });
    });
    renderList();
    expect(await screen.findByText(/尚未同步過/)).toBeInTheDocument();
  });

  test('連續失敗 3 次以上顯示警告', async () => {
    apiGet.mockImplementation((url) => {
      if (url.includes('sync-crawler')) {
        return Promise.resolve({
          status: {
            last_success_at: null,
            consecutive_failures: 4,
          },
        });
      }
      return Promise.resolve({
        results: [],
        count: 0,
        page: 1,
        page_size: 10,
      });
    });
    renderList();
    expect(await screen.findByText(/爬蟲同步已連續失敗 4 次/)).toBeInTheDocument();
  });

  test('點擊同步按鈕會呼叫 POST 端點、重新載入列表並顯示筆數訊息', async () => {
    apiPost.mockResolvedValue({
      available: true,
      imported: 3,
      skipped_existing: 1,
      skipped_invalid: 0,
      failed: 0,
      status: {
        ...syncStatusResponse.status,
        last_imported_count: 3,
        last_skipped_count: 1,
      },
    });
    renderList();
    const button = await screen.findByRole('button', { name: /同步爬蟲活動/ });
    const listCallsBefore = apiGet.mock.calls
      .filter(([url]) => !url.includes('sync-crawler')).length;

    fireEvent.click(button);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/adminapi/announcements/sync-crawler/');
    });
    expect(await screen.findByText('已同步：新增 3 筆、略過 1 筆')).toBeInTheDocument();
    await waitFor(() => {
      const listCallsAfter = apiGet.mock.calls
        .filter(([url]) => !url.includes('sync-crawler')).length;
      expect(listCallsAfter).toBeGreaterThan(listCallsBefore);
    });
  });

  test('來源篩選送出後，查詢字串帶上 source 參數', async () => {
    renderList();
    await screen.findByText('草稿公告');
    fireEvent.change(
      screen.getByLabelText('來源'),
      { target: { value: 'crawler' } },
    );
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }));

    await waitFor(() => {
      const [url] = apiGet.mock.calls
        .filter(([callUrl]) => !callUrl.includes('sync-crawler'))
        .at(-1);
      expect(url).toContain('source=crawler');
    });
  });

  test('source=crawler 的列會顯示「爬蟲」徽章，後台自建的不會', async () => {
    apiGet.mockImplementation((url) => {
      if (url.includes('sync-crawler')) return Promise.resolve(syncStatusResponse);
      return Promise.resolve({
        results: [
          { ...draftItem, source: 'admin' },
          { ...pendingItem, source: 'crawler' },
        ],
        count: 2,
        page: 1,
        page_size: 10,
      });
    });
    renderList();
    const crawlerRow = await screen.findByText('待審公告').then((el) => el.closest('tr'));
    const adminRow = screen.getByText('草稿公告').closest('tr');
    expect(within(crawlerRow).getByText('爬蟲')).toBeInTheDocument();
    expect(within(adminRow).queryByText('爬蟲')).not.toBeInTheDocument();
  });
});
