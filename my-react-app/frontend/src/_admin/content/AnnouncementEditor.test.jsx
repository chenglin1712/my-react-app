import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
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
        <Route
          path="/admin/content/announcements/new"
          element={<AnnouncementEditor />}
        />
        <Route
          path="/admin/content/announcements/:id"
          element={<AnnouncementEditor />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function renderEdit(id) {
  return render(
    <MemoryRouter initialEntries={[`/admin/content/announcements/${id}`]}>
      <Routes>
        <Route
          path="/admin/content/announcements/:id"
          element={<AnnouncementEditor />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

// 同一個 <MemoryRouter> 底下切換兩個不同 id 的網址（不是分開兩次
// render）：驗證同一個 AnnouncementEditor 元件實體從 A 切到 B 時，會不會
// 殘留 A 的表單內容。
function renderSwitchable(firstId) {
  return render(
    <MemoryRouter initialEntries={[`/admin/content/announcements/${firstId}`]}>
      <Routes>
        <Route
          path="/admin/content/announcements/:id"
          element={(
            <>
              <Link to="/admin/content/announcements/99">切到另一筆</Link>
              <AnnouncementEditor />
            </>
          )}
        />
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
    fireEvent.change(
      screen.getByLabelText(/標題/),
      { target: { value: '測試公告' } },
    );
    // react-bootstrap 的 Form.Check type="switch" 只是套用不同 CSS 樣式的
    // checkbox，底層 <input type="checkbox"> 沒有 role="switch"，可及性
    // 角色仍然是 checkbox。
    fireEvent.click(screen.getByRole('checkbox', { name: '置頂公告' }));
    fireEvent.click(screen.getByRole('button', { name: /儲存並送審/ }));
    expect(
      await screen.findByText('開啟置頂時，置頂到期日為必填'),
    ).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  test('排程發布時間會轉成帶時區的 ISO 字串再送出（不能是沒有時區的原始字串）', async () => {
    // 回歸測試：datetime-local 的值（例如 "2026-08-15T14:30"）沒有時區資訊，
    // 直接送給後端會被當成 UTC，造成使用者設定的時間整個偏移。
    apiPost.mockResolvedValueOnce({ id: 99, status: 'draft' });
    renderNew();
    fireEvent.change(
      screen.getByLabelText(/標題/),
      { target: { value: '排程測試' } },
    );
    fireEvent.change(
      screen.getByLabelText('排程發布時間'),
      { target: { value: '2026-08-15T14:30' } },
    );
    fireEvent.click(screen.getByRole('button', { name: /儲存$/ }));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const [, payload] = apiPost.mock.calls[0];
    expect(payload.publish_at).toMatch(/Z$/);
    expect(payload.publish_at).not.toBe('2026-08-15T14:30');
    // 轉換後應該能還原回同一個時間點（不是隨便一個帶 Z 的字串）。
    expect(new Date(payload.publish_at).getTime())
      .toBe(new Date('2026-08-15T14:30').getTime());
  });

  test('沒填排程時間時送出 null，而不是空字串', async () => {
    apiPost.mockResolvedValueOnce({ id: 99, status: 'draft' });
    renderNew();
    fireEvent.change(
      screen.getByLabelText(/標題/),
      { target: { value: '沒有排程' } },
    );
    fireEvent.click(screen.getByRole('button', { name: /儲存$/ }));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const [, payload] = apiPost.mock.calls[0];
    expect(payload.publish_at).toBeNull();
    expect(payload.unpublish_at).toBeNull();
  });

  test('「儲存並送審」會先建立再呼叫 submit 端點', async () => {
    apiPost.mockImplementation((url) => {
      if (url === '/adminapi/announcements/') {
        return Promise.resolve({ id: 42, status: 'draft' });
      }
      if (url === '/adminapi/announcements/42/submit/') {
        return Promise.resolve({ status: 'pending_review' });
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    renderNew();
    fireEvent.change(
      screen.getByLabelText(/標題/),
      { target: { value: '要送審的公告' } },
    );
    fireEvent.click(screen.getByRole('button', { name: /儲存並送審/ }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/announcements/42/submit/',
      );
    });
    expect(await screen.findByText('已儲存並送審')).toBeInTheDocument();
    // 建立成功後 navigate 到 /42 會讓 id 改變；這篇公告才剛建立、資料
    // 本來就是最新的，不該觸發 [id] effect 對它重新 fetch 一次——那個
    // effect 開頭的 setSuccess('') 會跟上面剛驗證過的送審成功訊息互踩。
    expect(apiGet).not.toHaveBeenCalled();
  });

  /** 回歸測試：建立成功、送審失敗時，畫面應該立刻換成該公告自己的網址，
   * 不能停留在 /new——原本的寫法要等 submit 也成功才會 navigate，送審
   * 失敗時畫面留在 /new（沒有 id），使用者以為儲存整個沒發生，再點一次
   * 「儲存並送審」會重新 POST 建立，變成建立兩筆重複公告。 */
  test('新公告建立成功、送審失敗時不會重複建立第二筆公告', async () => {
    apiPost.mockImplementation((url) => {
      if (url === '/adminapi/announcements/') {
        return Promise.resolve({ id: 42, status: 'draft' });
      }
      if (url === '/adminapi/announcements/42/submit/') {
        return Promise.reject(new Error('伺服器暫時無法處理，請稍後再試'));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    apiGet.mockResolvedValue({
      id: 42,
      title: '要送審的公告',
      body: '',
      category: 'announcement',
      tribes: [],
      cover_image_url: '',
      link_url: '',
      is_pinned: false,
      pin_until: null,
      publish_at: null,
      unpublish_at: null,
      status: 'draft',
    });
    apiPatch.mockResolvedValueOnce({ status: 'draft' });

    renderNew();
    fireEvent.change(
      screen.getByLabelText(/標題/),
      { target: { value: '要送審的公告' } },
    );
    fireEvent.click(screen.getByRole('button', { name: /儲存並送審/ }));

    expect(await screen.findByText('伺服器暫時無法處理，請稍後再試')).toBeInTheDocument();
    // 畫面已經換成編輯模式（有 id），不再是「新增公告」。
    expect(await screen.findByText('編輯公告')).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledWith(
      '/adminapi/announcements/',
      expect.any(Object),
    );
    expect(apiPost).toHaveBeenCalledTimes(2);

    // 再次點擊「儲存」應該走 PATCH（因為畫面現在已經有 id），不會再
    // POST 建立第二筆公告。
    fireEvent.click(screen.getByRole('button', { name: /^儲存$/ }));
    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        '/adminapi/announcements/42/',
        expect.any(Object),
      );
    });
    expect(apiPost).toHaveBeenCalledTimes(2);
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
      id: 7,
      title: '既有公告',
      body: '內文',
      category: 'exam',
      tribes: ['tayal'],
      cover_image_url: '',
      link_url: '',
      is_pinned: false,
      pin_until: null,
      publish_at: null,
      unpublish_at: null,
      status: 'draft',
    });
    renderEdit(7);
    expect(await screen.findByDisplayValue('既有公告')).toBeInTheDocument();
    expect(screen.getByDisplayValue('內文')).toBeInTheDocument();
  });

  test('狀態是 pending_review 時全部欄位唯讀，且看不到儲存按鈕', async () => {
    apiGet.mockResolvedValueOnce({
      id: 8,
      title: '送審中的公告',
      body: '',
      category: 'announcement',
      tribes: [],
      cover_image_url: '',
      link_url: '',
      is_pinned: false,
      pin_until: null,
      publish_at: null,
      unpublish_at: null,
      status: 'pending_review',
    });
    renderEdit(8);
    expect(await screen.findByDisplayValue('送審中的公告')).toBeDisabled();
    expect(screen.getByText(/送審中的公告請先撤回/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /儲存$/ }),
    ).not.toBeInTheDocument();
  });

  test('編輯時儲存呼叫 PATCH 而不是 POST', async () => {
    apiGet.mockResolvedValueOnce({
      id: 9,
      title: '可編輯的草稿',
      body: '',
      category: 'announcement',
      tribes: [],
      cover_image_url: '',
      link_url: '',
      is_pinned: false,
      pin_until: null,
      publish_at: null,
      unpublish_at: null,
      status: 'draft',
    });
    apiPatch.mockResolvedValueOnce({ status: 'draft' });
    renderEdit(9);
    await screen.findByDisplayValue('可編輯的草稿');
    fireEvent.click(screen.getByRole('button', { name: /儲存$/ }));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        '/adminapi/announcements/9/',
        expect.any(Object),
      );
    });
    expect(apiPost).not.toHaveBeenCalled();
  });

  test('published 公告載入時查詢 pending revision，並用 payload 覆蓋對應欄位', async () => {
    const publishedAnnouncement = {
      id: 20,
      title: '目前正式標題',
      body: '目前仍在首頁顯示的正式內文',
      category: 'announcement',
      tribes: ['tayal'],
      cover_image_url: 'https://example.com/original.jpg',
      link_url: 'https://example.com/original',
      is_pinned: false,
      pin_until: null,
      publish_at: null,
      unpublish_at: null,
      status: 'published',
      display_date_text: '正式日期',
      source: 'admin',
      has_pending_revision: true,
    };
    const pendingRevision = {
      id: 5,
      payload: {
        title: '待審修改標題',
        category: 'activity',
        link_url: 'https://example.com/revised',
        display_date_text: '修改後日期',
      },
      submitted_by: 'editor-uid',
      submitted_at: '2026-08-03T01:00:00Z',
    };

    apiGet.mockImplementation((url) => {
      if (url === '/adminapi/announcements/20/') {
        return Promise.resolve(publishedAnnouncement);
      }
      if (url === '/adminapi/announcements/20/pending-revision/') {
        return Promise.resolve(pendingRevision);
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    renderEdit(20);

    expect(
      await screen.findByDisplayValue('待審修改標題'),
    ).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith(
      '/adminapi/announcements/20/pending-revision/',
    );

    // payload 有帶的欄位使用提案值。
    expect(screen.getByLabelText(/分類/)).toHaveValue('activity');
    expect(screen.getByLabelText(/外部連結/))
      .toHaveValue('https://example.com/revised');
    expect(screen.getByLabelText(/顯示日期文字/))
      .toHaveValue('修改後日期');

    // payload 未帶的欄位仍沿用目前正式公告，不能被清成空值。
    expect(
      screen.getByDisplayValue('目前仍在首頁顯示的正式內文'),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '泰雅語' })).toBeChecked();
  });

  test('published 公告沒有 pending revision 時，404 不顯示錯誤並沿用正式內容', async () => {
    apiGet.mockImplementation((url) => {
      if (url === '/adminapi/announcements/21/') {
        return Promise.resolve({
          id: 21,
          title: '沒有待審修改的正式公告',
          body: '正式內文',
          category: 'announcement',
          tribes: [],
          cover_image_url: '',
          link_url: '',
          is_pinned: false,
          pin_until: null,
          publish_at: null,
          unpublish_at: null,
          status: 'published',
          display_date_text: '',
          source: 'admin',
          has_pending_revision: false,
        });
      }
      if (url === '/adminapi/announcements/21/pending-revision/') {
        const error = new Error('目前沒有待審核的修改');
        error.status = 404;
        return Promise.reject(error);
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    renderEdit(21);

    expect(
      await screen.findByDisplayValue('沒有待審修改的正式公告'),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('正式內文')).toBeInTheDocument();
    expect(
      screen.queryByText('目前沒有待審核的修改'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /提交修改/ }))
      .toBeInTheDocument();
  });

  test('published 狀態提交修改呼叫 POST pending-revision，而不是 PATCH', async () => {
    apiGet.mockImplementation((url) => {
      if (url === '/adminapi/announcements/22/') {
        return Promise.resolve({
          id: 22,
          title: '已發布的原標題',
          body: '已發布內文',
          category: 'announcement',
          tribes: [],
          cover_image_url: '',
          link_url: '',
          is_pinned: false,
          pin_until: null,
          publish_at: null,
          unpublish_at: null,
          status: 'published',
          display_date_text: '',
          source: 'admin',
          has_pending_revision: false,
        });
      }
      if (url === '/adminapi/announcements/22/pending-revision/') {
        const error = new Error('目前沒有待審核的修改');
        error.status = 404;
        return Promise.reject(error);
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    apiPost.mockResolvedValueOnce({
      id: 6,
      payload: { title: '已發布公告的新標題' },
      submitted_by: 'owner-uid',
      submitted_at: '2026-08-03T02:00:00Z',
    });

    renderEdit(22);

    await screen.findByDisplayValue('已發布的原標題');
    fireEvent.change(
      screen.getByLabelText(/標題/),
      { target: { value: '已發布公告的新標題' } },
    );

    expect(
      screen.getByRole('button', { name: /提交修改/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /儲存並送審/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^儲存$/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /提交修改/ }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/announcements/22/pending-revision/',
        expect.objectContaining({
          title: '已發布公告的新標題',
          body: '已發布內文',
          category: 'announcement',
        }),
      );
    });
    expect(apiPatch).not.toHaveBeenCalled();
    expect(
      await screen.findByText('已提交修改，待審核核准後生效'),
    ).toBeInTheDocument();
    expect(screen.getByText(/目前狀態：已發布/)).toBeInTheDocument();
  });

  test('published 的 pending revision 查詢若不是 404，會顯示錯誤而非靜默忽略', async () => {
    apiGet.mockImplementation((url) => {
      if (url === '/adminapi/announcements/23/') {
        return Promise.resolve({
          id: 23,
          title: '正式公告',
          body: '',
          category: 'announcement',
          tribes: [],
          cover_image_url: '',
          link_url: '',
          is_pinned: false,
          pin_until: null,
          publish_at: null,
          unpublish_at: null,
          status: 'published',
          display_date_text: '',
          source: 'admin',
        });
      }
      if (url === '/adminapi/announcements/23/pending-revision/') {
        const error = new Error('無法載入待審修改');
        error.status = 500;
        return Promise.reject(error);
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    renderEdit(23);

    expect(
      await screen.findByText('無法載入待審修改'),
    ).toBeInTheDocument();
  });

  test('置頂到期日（純日期欄位）載入後不會因時區換算跨日', async () => {
    // 回歸測試：toLocalInput 的 date-only 分支過去會把 "2026-09-01" 丟進
    // new Date() 當 UTC 午夜解析，再用本地時區換算——在 UTC 負偏移地區
    // 會變成 "2026-08-31"。這裡驗證欄位值原樣是 "2026-09-01"，不依賴
    // 測試環境的時區設定（因為根本不該經過任何時區換算）。
    apiGet.mockResolvedValueOnce({
      id: 12,
      title: '置頂公告',
      body: '',
      category: 'announcement',
      tribes: [],
      cover_image_url: '',
      link_url: '',
      is_pinned: true,
      pin_until: '2026-09-01',
      publish_at: null,
      unpublish_at: null,
      status: 'draft',
    });
    renderEdit(12);
    await screen.findByDisplayValue('置頂公告');
    expect(screen.getByLabelText(/置頂到期日/))
      .toHaveValue('2026-09-01');
  });

  test('已下架的公告可以編輯（視同重新起草）', async () => {
    apiGet.mockResolvedValueOnce({
      id: 10,
      title: '已下架的公告',
      body: '',
      category: 'announcement',
      tribes: [],
      cover_image_url: '',
      link_url: '',
      is_pinned: false,
      pin_until: null,
      publish_at: null,
      unpublish_at: null,
      status: 'unpublished',
    });
    renderEdit(10);
    expect(
      await screen.findByDisplayValue('已下架的公告'),
    ).not.toBeDisabled();
    expect(
      screen.getByRole('button', { name: /儲存$/ }),
    ).toBeInTheDocument();
  });

  test('reviewer 檢視草稿：狀態允許編輯，但角色不是內容編輯者，欄位仍唯讀', async () => {
    // 回歸測試：editable 過去只看狀態不看角色，reviewer／analyst 會在
    // draft／rejected／unpublished 狀態下看到看起來可以存檔的表單，實際
    // 送出會被後端 require_role(CONTENT_EDITORS) 擋成 403。
    mockRole = 'reviewer';
    apiGet.mockResolvedValueOnce({
      id: 11,
      title: '草稿內容',
      body: '',
      category: 'announcement',
      tribes: [],
      cover_image_url: '',
      link_url: '',
      is_pinned: false,
      pin_until: null,
      publish_at: null,
      unpublish_at: null,
      status: 'draft',
    });
    renderEdit(11);
    expect(await screen.findByDisplayValue('草稿內容')).toBeDisabled();
    expect(
      screen.getByText(/目前角色沒有內容編輯權限/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /儲存$/ }),
    ).not.toBeInTheDocument();
  });

  test('載入既有的 display_date_text 並帶入表單', async () => {
    apiGet.mockResolvedValueOnce({
      id: 13,
      title: '有日期文字的公告',
      body: '',
      category: 'activity',
      tribes: [],
      cover_image_url: '',
      link_url: '',
      is_pinned: false,
      pin_until: null,
      publish_at: null,
      unpublish_at: null,
      status: 'draft',
      display_date_text: '2026-08-01 ~ 2026-08-10',
      source: 'crawler',
    });
    renderEdit(13);
    expect(
      await screen.findByDisplayValue('2026-08-01 ~ 2026-08-10'),
    ).toBeInTheDocument();
  });

  test('編輯 display_date_text 後儲存，payload 帶上修改後的值', async () => {
    apiGet.mockResolvedValueOnce({
      id: 14,
      title: '待編輯日期文字',
      body: '',
      category: 'activity',
      tribes: [],
      cover_image_url: '',
      link_url: '',
      is_pinned: false,
      pin_until: null,
      publish_at: null,
      unpublish_at: null,
      status: 'draft',
      display_date_text: '',
      source: 'admin',
    });
    apiPatch.mockResolvedValueOnce({ status: 'draft' });
    renderEdit(14);
    await screen.findByDisplayValue('待編輯日期文字');
    fireEvent.change(
      screen.getByLabelText(/顯示日期文字/),
      { target: { value: '2026-09-01' } },
    );
    fireEvent.click(screen.getByRole('button', { name: /儲存$/ }));

    await waitFor(() => {
      const [, payload] = apiPatch.mock.calls[0];
      expect(payload.display_date_text).toBe('2026-09-01');
    });
  });

  test('source=crawler 時顯示「爬蟲匯入」提示', async () => {
    apiGet.mockImplementation((url) => {
      if (url === '/adminapi/announcements/15/') {
        return Promise.resolve({
          id: 15,
          title: '爬蟲匯入的公告',
          body: '',
          category: 'activity',
          tribes: [],
          cover_image_url: '',
          link_url: '',
          is_pinned: false,
          pin_until: null,
          publish_at: null,
          unpublish_at: null,
          status: 'published',
          display_date_text: '',
          source: 'crawler',
        });
      }
      if (url === '/adminapi/announcements/15/pending-revision/') {
        const error = new Error('目前沒有待審核的修改');
        error.status = 404;
        return Promise.reject(error);
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    renderEdit(15);
    expect(await screen.findByText('爬蟲匯入')).toBeInTheDocument();
  });

  test('source=admin 時不顯示「爬蟲匯入」提示', async () => {
    apiGet.mockResolvedValueOnce({
      id: 16,
      title: '後台自建的公告',
      body: '',
      category: 'announcement',
      tribes: [],
      cover_image_url: '',
      link_url: '',
      is_pinned: false,
      pin_until: null,
      publish_at: null,
      unpublish_at: null,
      status: 'draft',
      display_date_text: '',
      source: 'admin',
    });
    renderEdit(16);
    await screen.findByDisplayValue('後台自建的公告');
    expect(screen.queryByText('爬蟲匯入')).not.toBeInTheDocument();
  });

  test('新增公告模式不顯示「爬蟲匯入」提示（一定是後台自建）', () => {
    renderNew();
    expect(screen.queryByText('爬蟲匯入')).not.toBeInTheDocument();
  });

  /** 回歸測試：同一個路由元件在 /A 跟 /B 之間切換時會被 React Router
   * 重用，不會重新掛載——切換到 B 時如果沒有先清空表單，B 載入失敗時
   * 畫面會留著 A 的可編輯內容，看起來像是在對 B 操作。 */
  test('切換到另一筆公告載入失敗時，不會殘留前一筆公告的表單內容', async () => {
    apiGet.mockImplementation((url) => {
      if (url === '/adminapi/announcements/20/') {
        return Promise.resolve({
          id: 20,
          title: 'A 公告的標題',
          body: 'A 公告的內文',
          category: 'announcement',
          tribes: [],
          cover_image_url: '',
          link_url: '',
          is_pinned: false,
          pin_until: null,
          publish_at: null,
          unpublish_at: null,
          status: 'draft',
        });
      }
      if (url === '/adminapi/announcements/99/') {
        return Promise.reject(new Error('伺服器暫時無法處理，請稍後再試'));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    renderSwitchable(20);
    await screen.findByDisplayValue('A 公告的標題');

    fireEvent.click(screen.getByRole('link', { name: '切到另一筆' }));

    expect(await screen.findByText('伺服器暫時無法處理，請稍後再試')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('A 公告的標題')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('A 公告的內文')).not.toBeInTheDocument();
  });
});
