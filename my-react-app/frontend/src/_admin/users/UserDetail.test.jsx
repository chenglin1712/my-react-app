import {
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import UserDetail from './UserDetail';
import {
  apiGet,
  apiPatch,
  apiPost,
} from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
}));

let mockRole = 'owner';

vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({
    userData: { role: mockRole },
    loading: false,
  }),
}));

const user = {
  uid: 'abc123',
  email: 'user@example.com',
  email_verified: true,
  disabled: false,
  role: 'editor',
  name: '王小明',
  identity: '學生',
  avatar_url: null,
  join_date: '2026-01-01T00:00:00.000Z',
  created_at: 1700000000000,
  last_sign_in_at: 1700000001000,
  provider_ids: ['password'],
  firestore: {
    favorites: ['word-1', 'word-2'],
    user_errors: { lesson1: 2 },
  },
  content_counts: {
    shared_notes: 3,
    pronunciations: 5,
  },
};

const secondUser = {
  uid: 'xyz789',
  email: 'second@example.com',
  email_verified: true,
  disabled: false,
  role: null,
  name: '第二位使用者',
  identity: '教師',
  avatar_url: null,
  join_date: '2026-02-01T00:00:00.000Z',
  created_at: 1700000200000,
  last_sign_in_at: 1700000201000,
  provider_ids: ['password'],
  firestore: {},
  content_counts: {},
};

let detailUser;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/users/abc123']}>
      <Routes>
        <Route
          path="/admin/users/:uid"
          element={<UserDetail />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

// 用來重現「同一個路由元件在兩個 uid 之間切換」的情境（React Router 不會
// 因為 :uid 參數改變就重新掛載元件）——UserList.jsx 點「詳情」進到別的
// 使用者，本質上就是同一種切換，這裡直接放兩個連結方便測試操控時機。
function renderSwitchable() {
  return render(
    <MemoryRouter initialEntries={['/admin/users/abc123']}>
      <Link to="/admin/users/xyz789">切到另一位使用者</Link>
      <Routes>
        <Route
          path="/admin/users/:uid"
          element={<UserDetail />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function mockDetailApi() {
  apiGet.mockImplementation((url) => {
    if (url === '/adminapi/users/abc123/') {
      return Promise.resolve(detailUser);
    }

    if (url === '/adminapi/users/xyz789/') {
      return Promise.resolve(secondUser);
    }

    if (url === '/adminapi/users/abc123/export/') {
      return Promise.resolve({
        uid: 'abc123',
        email: detailUser.email,
      });
    }

    return Promise.reject(new Error(`unexpected url: ${url}`));
  });
}

describe('UserDetail', () => {
  beforeEach(() => {
    mockRole = 'owner';
    detailUser = { ...user };
    apiGet.mockReset();
    apiPatch.mockReset();
    apiPost.mockReset();
    mockDetailApi();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  test('顯示基本資料、產出計數與 Firestore 原始欄位', async () => {
    renderPage();

    expect(await screen.findByText('王小明')).toBeInTheDocument();
    expect(screen.getByText('user@example.com')).toBeInTheDocument();
    expect(
      screen.getByText('內容編輯', { selector: 'span' }),
    ).toBeInTheDocument();
    expect(screen.getByText('password')).toBeInTheDocument();
    expect(screen.getByText('分享筆記')).toBeInTheDocument();
    expect(screen.getByText('發音錄音')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('favorites')).toBeInTheDocument();
    expect(screen.getByText('user_errors')).toBeInTheDocument();
  });

  test('owner 可以指派角色並在完成後重新載入資料', async () => {
    apiPost.mockResolvedValueOnce({
      uid: 'abc123',
      role: 'reviewer',
    });

    renderPage();
    await screen.findByText('王小明');

    const callsBefore = apiGet.mock.calls
      .filter(([url]) => url === '/adminapi/users/abc123/')
      .length;

    fireEvent.change(
      screen.getByLabelText('新角色'),
      { target: { value: 'reviewer' } },
    );
    fireEvent.click(
      screen.getByRole('button', { name: '更新角色' }),
    );

    expect(window.confirm).toHaveBeenCalled();

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/users/abc123/role/',
        { role: 'reviewer' },
      );
    });

    await waitFor(() => {
      const callsAfter = apiGet.mock.calls
        .filter(([url]) => url === '/adminapi/users/abc123/')
        .length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
  });

  test('選擇移除角色時送出 null', async () => {
    apiPost.mockResolvedValueOnce({
      uid: 'abc123',
      role: null,
    });

    renderPage();
    await screen.findByText('王小明');

    fireEvent.change(
      screen.getByLabelText('新角色'),
      { target: { value: '' } },
    );
    fireEvent.click(
      screen.getByRole('button', { name: '更新角色' }),
    );

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/users/abc123/role/',
        { role: null },
      );
    });
  });

  test('owner 可以開啟編輯資料 Modal，欄位會以現有資料預填', async () => {
    renderPage();
    await screen.findByText('王小明');

    fireEvent.click(
      screen.getByRole('button', { name: '編輯' }),
    );

    const modal = await screen.findByRole('dialog');

    expect(
      within(modal).getByText('編輯使用者資料'),
    ).toBeInTheDocument();
    expect(within(modal).getByLabelText('姓名')).toHaveValue('王小明');
    expect(within(modal).getByLabelText('身分')).toHaveValue('學生');
    expect(within(modal).getByLabelText('頭像')).toHaveAttribute('type', 'file');
    expect(within(modal).getByLabelText('Email')).toHaveValue(
      'user@example.com',
    );
  });

  test('儲存編輯資料時呼叫 PATCH 並重新載入使用者', async () => {
    apiPatch.mockResolvedValueOnce({
      ...user,
      name: '王大明',
      identity: '教師',
      email: 'updated@example.com',
    });

    renderPage();
    await screen.findByText('王小明');

    const callsBefore = apiGet.mock.calls
      .filter(([url]) => url === '/adminapi/users/abc123/')
      .length;

    fireEvent.click(
      screen.getByRole('button', { name: '編輯' }),
    );

    const modal = await screen.findByRole('dialog');

    fireEvent.change(
      within(modal).getByLabelText('姓名'),
      { target: { value: '王大明' } },
    );
    fireEvent.change(
      within(modal).getByLabelText('身分'),
      { target: { value: '教師' } },
    );
    fireEvent.change(
      within(modal).getByLabelText('Email'),
      { target: { value: 'updated@example.com' } },
    );

    fireEvent.click(
      within(modal).getByRole('button', { name: '儲存' }),
    );

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        '/adminapi/users/abc123/profile/',
        {
          name: '王大明',
          identity: '教師',
          avatar_url: '',
          email: 'updated@example.com',
        },
      );
    });

    await waitFor(() => {
      const callsAfter = apiGet.mock.calls
        .filter(([url]) => url === '/adminapi/users/abc123/')
        .length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });

    expect(
      await screen.findByText('使用者資料已更新。'),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  test('頭像檔案超過 5 MB 時顯示錯誤且不上傳', async () => {
    renderPage();
    await screen.findByText('王小明');

    fireEvent.click(
      screen.getByRole('button', { name: '編輯' }),
    );

    const modal = await screen.findByRole('dialog');
    const bigFile = new File(
      [new Uint8Array(6 * 1024 * 1024)],
      'avatar.png',
      { type: 'image/png' },
    );

    fireEvent.change(
      within(modal).getByLabelText('頭像'),
      { target: { files: [bigFile] } },
    );

    expect(
      await screen.findByText('檔案不得超過 5 MB，請重新選擇。'),
    ).toBeInTheDocument();
    expect(
      within(modal).queryByText('頭像上傳中……'),
    ).not.toBeInTheDocument();
  });

  test('編輯資料失敗時顯示後端錯誤並保留 Modal', async () => {
    apiPatch.mockRejectedValueOnce(
      new Error('這個 email 已經被使用'),
    );

    renderPage();
    await screen.findByText('王小明');

    fireEvent.click(
      screen.getByRole('button', { name: '編輯' }),
    );

    const modal = await screen.findByRole('dialog');

    fireEvent.change(
      within(modal).getByLabelText('Email'),
      { target: { value: 'duplicate@example.com' } },
    );
    fireEvent.click(
      within(modal).getByRole('button', { name: '儲存' }),
    );

    expect(
      await screen.findByText('這個 email 已經被使用'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('變更密碼必須符合長度、確認密碼與 Email 才能送出', async () => {
    apiPost.mockResolvedValueOnce({
      uid: 'abc123',
      password_changed: true,
      sessions_revoked: true,
    });

    renderPage();
    await screen.findByText('王小明');

    fireEvent.click(
      screen.getByRole('button', { name: '變更密碼' }),
    );

    const modal = await screen.findByRole('dialog');
    const submitButton = within(modal).getByRole(
      'button',
      { name: '確認變更密碼' },
    );

    expect(submitButton).toBeDisabled();

    fireEvent.change(
      within(modal).getByLabelText('新密碼'),
      { target: { value: '12345' } },
    );
    fireEvent.change(
      within(modal).getByLabelText('確認新密碼'),
      { target: { value: '12345' } },
    );
    fireEvent.change(
      within(modal).getByLabelText('輸入帳號 Email 以確認變更密碼'),
      { target: { value: 'user@example.com' } },
    );
    expect(submitButton).toBeDisabled();

    fireEvent.change(
      within(modal).getByLabelText('新密碼'),
      { target: { value: 'secret123' } },
    );
    expect(submitButton).toBeDisabled();

    fireEvent.change(
      within(modal).getByLabelText('確認新密碼'),
      { target: { value: 'different123' } },
    );
    expect(submitButton).toBeDisabled();
    expect(
      within(modal).getByText('兩次輸入的密碼不相同。'),
    ).toBeInTheDocument();

    fireEvent.change(
      within(modal).getByLabelText('確認新密碼'),
      { target: { value: 'secret123' } },
    );
    expect(submitButton).not.toBeDisabled();

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/users/abc123/password/',
        {
          new_password: 'secret123',
          confirm_email: 'user@example.com',
        },
      );
    });

    expect(
      await screen.findByText(
        '密碼已變更，並已撤銷此帳號現有的登入狀態。',
      ),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  test('變更密碼成功但撤銷登入狀態失敗時顯示對應提示', async () => {
    // 後端誠實回報 sessions_revoked: false（見 user_password() 的說明）——
    // 前端不能一律顯示「已撤銷」，那樣會誤導管理者以為舊登入狀態已經
    // 失效，實際上密碼雖然改了但舊 session 可能還能用。
    apiPost.mockResolvedValueOnce({
      uid: 'abc123',
      password_changed: true,
      sessions_revoked: false,
    });

    renderPage();
    await screen.findByText('王小明');

    fireEvent.click(
      screen.getByRole('button', { name: '變更密碼' }),
    );

    const modal = await screen.findByRole('dialog');
    fireEvent.change(
      within(modal).getByLabelText('新密碼'),
      { target: { value: 'secret123' } },
    );
    fireEvent.change(
      within(modal).getByLabelText('確認新密碼'),
      { target: { value: 'secret123' } },
    );
    fireEvent.change(
      within(modal).getByLabelText('輸入帳號 Email 以確認變更密碼'),
      { target: { value: 'user@example.com' } },
    );

    fireEvent.click(
      within(modal).getByRole('button', { name: '確認變更密碼' }),
    );

    expect(
      await screen.findByText(
        '密碼已變更，但撤銷登入狀態失敗，此帳號的舊登入可能仍然有效，請稍後重新嘗試或聯繫系統管理員。',
      ),
    ).toBeInTheDocument();
  });

  test('變更密碼 Email 不符時確認按鈕維持停用', async () => {
    renderPage();
    await screen.findByText('王小明');

    fireEvent.click(
      screen.getByRole('button', { name: '變更密碼' }),
    );

    const modal = await screen.findByRole('dialog');

    fireEvent.change(
      within(modal).getByLabelText('新密碼'),
      { target: { value: 'secret123' } },
    );
    fireEvent.change(
      within(modal).getByLabelText('確認新密碼'),
      { target: { value: 'secret123' } },
    );
    fireEvent.change(
      within(modal).getByLabelText('輸入帳號 Email 以確認變更密碼'),
      { target: { value: 'wrong@example.com' } },
    );

    expect(
      within(modal).getByRole('button', { name: '確認變更密碼' }),
    ).toBeDisabled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  test('變更密碼失敗時顯示後端錯誤', async () => {
    apiPost.mockRejectedValueOnce(
      new Error('輸入的 email 與目標帳號不符'),
    );

    renderPage();
    await screen.findByText('王小明');

    fireEvent.click(
      screen.getByRole('button', { name: '變更密碼' }),
    );

    const modal = await screen.findByRole('dialog');

    fireEvent.change(
      within(modal).getByLabelText('新密碼'),
      { target: { value: 'secret123' } },
    );
    fireEvent.change(
      within(modal).getByLabelText('確認新密碼'),
      { target: { value: 'secret123' } },
    );
    fireEvent.change(
      within(modal).getByLabelText('輸入帳號 Email 以確認變更密碼'),
      { target: { value: 'user@example.com' } },
    );
    fireEvent.click(
      within(modal).getByRole('button', { name: '確認變更密碼' }),
    );

    expect(
      await screen.findByText('輸入的 email 與目標帳號不符'),
    ).toBeInTheDocument();
  });

  test('admin 看不到角色指派，但可以編輯資料、變更密碼與停權帳號', async () => {
    mockRole = 'admin';
    apiPost.mockResolvedValueOnce({
      uid: 'abc123',
      disabled: true,
    });

    renderPage();
    await screen.findByText('王小明');

    expect(screen.queryByLabelText('新角色')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '編輯' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '變更密碼' }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: '停權帳號' }),
    );

    expect(window.confirm).toHaveBeenCalled();

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/users/abc123/suspend/',
      );
    });
  });

  test('admin 檢視 owner 時不顯示編輯資料與變更密碼操作', async () => {
    mockRole = 'admin';
    detailUser = {
      ...user,
      role: 'owner',
    };

    renderPage();
    await screen.findByText('王小明');

    expect(
      screen.queryByRole('button', { name: '編輯' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '變更密碼' }),
    ).not.toBeInTheDocument();
  });

  test('owner 檢視 owner 時仍可編輯資料與變更密碼', async () => {
    detailUser = {
      ...user,
      role: 'owner',
    };

    renderPage();
    await screen.findByText('王小明');

    expect(
      screen.getByRole('button', { name: '編輯' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '變更密碼' }),
    ).toBeInTheDocument();
  });

  test('強制登出會呼叫正確端點並顯示成功訊息', async () => {
    apiPost.mockResolvedValueOnce({
      uid: 'abc123',
      revoked: true,
    });

    renderPage();
    await screen.findByText('王小明');

    fireEvent.click(
      screen.getByRole('button', { name: '強制登出' }),
    );

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/users/abc123/force-logout/',
      );
    });

    expect(
      await screen.findByText('已撤銷使用者的登入憑證。'),
    ).toBeInTheDocument();
  });

  test('刪除 Modal 必須輸入完全相同的 Email 才能送出', async () => {
    apiPost.mockResolvedValueOnce({
      uid: 'abc123',
      results: {
        shared_notes: { deleted: 3 },
        pronunciations: { deleted: 5 },
        firestore_user_document: { deleted: true },
        firebase_auth: { deleted: true },
      },
    });

    renderPage();
    await screen.findByText('王小明');

    fireEvent.click(
      screen.getByRole('button', { name: '刪除帳號' }),
    );

    const modal = await screen.findByRole('dialog');
    const confirmButton = within(modal).getByRole(
      'button',
      { name: '確認刪除' },
    );

    expect(confirmButton).toBeDisabled();

    fireEvent.change(
      within(modal).getByLabelText('輸入帳號 Email 以確認刪除'),
      { target: { value: 'wrong@example.com' } },
    );
    expect(confirmButton).toBeDisabled();

    fireEvent.change(
      within(modal).getByLabelText('輸入帳號 Email 以確認刪除'),
      { target: { value: 'user@example.com' } },
    );
    expect(confirmButton).not.toBeDisabled();

    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/users/abc123/delete/',
        { confirm_email: 'user@example.com' },
      );
    });
  });

  test('刪除後逐項呈現成功與部分失敗結果', async () => {
    apiPost.mockResolvedValueOnce({
      uid: 'abc123',
      results: {
        shared_notes: { deleted: 3 },
        pronunciations: {
          deleted: 0,
          error: '刪除失敗，需人工複查',
        },
        firestore_user_document: { deleted: true },
        firebase_auth: {
          deleted: false,
          error: 'Firebase 暫時無法使用',
        },
      },
    });

    renderPage();
    await screen.findByText('王小明');

    fireEvent.click(
      screen.getByRole('button', { name: '刪除帳號' }),
    );

    const modal = await screen.findByRole('dialog');

    fireEvent.change(
      within(modal).getByLabelText('輸入帳號 Email 以確認刪除'),
      { target: { value: 'user@example.com' } },
    );
    fireEvent.click(
      within(modal).getByRole('button', { name: '確認刪除' }),
    );

    expect(
      await screen.findByText('帳號刪除結果'),
    ).toBeInTheDocument();
    expect(screen.getByText('已刪除 3 筆')).toBeInTheDocument();
    expect(
      screen.getByText('刪除失敗，需人工複查'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Firebase 暫時無法使用'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /返回使用者列表/ }),
    ).toHaveAttribute('href', '/admin/users');
  });

  test('刪除 Email 不符時在 Alert 顯示後端錯誤', async () => {
    apiPost.mockRejectedValueOnce(
      new Error('輸入的 email 與目標帳號不符'),
    );

    renderPage();
    await screen.findByText('王小明');

    fireEvent.click(
      screen.getByRole('button', { name: '刪除帳號' }),
    );

    const modal = await screen.findByRole('dialog');

    fireEvent.change(
      within(modal).getByLabelText('輸入帳號 Email 以確認刪除'),
      { target: { value: 'user@example.com' } },
    );
    fireEvent.click(
      within(modal).getByRole('button', { name: '確認刪除' }),
    );

    expect(
      await screen.findByText('輸入的 email 與目標帳號不符'),
    ).toBeInTheDocument();
  });

  test('找不到使用者時顯示錯誤及返回列表按鈕', async () => {
    apiGet.mockReset();
    apiGet.mockRejectedValueOnce(new Error('找不到這個使用者'));

    renderPage();

    expect(
      await screen.findByText('找不到這個使用者'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /返回使用者列表/ }),
    ).toHaveAttribute('href', '/admin/users');
  });

  test('editor 只能檢視資料，不顯示帳號管理操作', async () => {
    mockRole = 'editor';

    renderPage();

    expect(await screen.findByText('王小明')).toBeInTheDocument();
    expect(screen.queryByLabelText('新角色')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '編輯' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '變更密碼' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '停權帳號' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '強制登出' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '刪除帳號' }),
    ).not.toBeInTheDocument();
  });

  test('切換到另一位使用者後，前一位晚到的載入結果不會蓋掉畫面', async () => {
    let resolveFirst;
    apiGet.mockImplementation((url) => {
      if (url === '/adminapi/users/abc123/') {
        return new Promise((resolve) => { resolveFirst = resolve; });
      }
      if (url === '/adminapi/users/xyz789/') {
        return Promise.resolve(secondUser);
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    renderSwitchable();

    // abc123 都還沒回來就切到 xyz789。
    fireEvent.click(screen.getByText('切到另一位使用者'));

    expect(await screen.findByText('第二位使用者')).toBeInTheDocument();

    // abc123 這時候才姍姍來遲。
    resolveFirst(detailUser);
    await waitFor(() => {
      expect(screen.getByText('第二位使用者')).toBeInTheDocument();
    });
    expect(screen.queryByText('王小明')).not.toBeInTheDocument();
  });

  test('刪除帳號後切到另一位使用者，不會停在前一位的刪除結果畫面', async () => {
    apiPost.mockResolvedValueOnce({
      uid: 'abc123',
      results: {
        shared_notes: { deleted: 1 },
        pronunciations: { deleted: 0 },
        firestore_user_document: { deleted: true },
        firebase_auth: { deleted: true },
      },
    });

    renderSwitchable();
    await screen.findByText('王小明');

    fireEvent.click(screen.getByRole('button', { name: '刪除帳號' }));
    const modal = await screen.findByRole('dialog');
    fireEvent.change(
      within(modal).getByLabelText('輸入帳號 Email 以確認刪除'),
      { target: { value: 'user@example.com' } },
    );
    fireEvent.click(within(modal).getByRole('button', { name: '確認刪除' }));

    expect(await screen.findByText('帳號刪除結果')).toBeInTheDocument();

    fireEvent.click(screen.getByText('切到另一位使用者'));

    expect(await screen.findByText('第二位使用者')).toBeInTheDocument();
    expect(screen.queryByText('帳號刪除結果')).not.toBeInTheDocument();
  });

  test('編輯資料 Modal 開著時切換使用者，Modal 會關閉且不送出 PATCH', async () => {
    renderSwitchable();
    await screen.findByText('王小明');

    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByText('切到另一位使用者'));

    expect(await screen.findByText('第二位使用者')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apiPatch).not.toHaveBeenCalled();
  });

  test('儲存資料進行中就切換使用者，稍後才回來的結果不會覆蓋新使用者畫面', async () => {
    let resolvePatch;
    apiPatch.mockImplementation(() => new Promise((resolve) => { resolvePatch = resolve; }));

    renderSwitchable();
    await screen.findByText('王小明');

    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    const modal = await screen.findByRole('dialog');
    fireEvent.click(within(modal).getByRole('button', { name: '儲存' }));

    // PATCH 還沒回來就切換使用者：Modal 因此關閉，但送出去的請求仍在飛。
    fireEvent.click(screen.getByText('切到另一位使用者'));
    expect(await screen.findByText('第二位使用者')).toBeInTheDocument();

    const callsBeforeResolve = apiGet.mock.calls.filter(
      ([url]) => url === '/adminapi/users/abc123/',
    ).length;

    // abc123 的儲存這時候才回來——完整跑完儲存成功後接著重新載入的那條鏈。
    await act(async () => {
      resolvePatch({ ...user, name: '王小明（已修改）' });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 已經切換掉的使用者，儲存完成不該再幫它重新發出載入請求，畫面也要
    // 還停在現在正在看的使用者身上。
    const callsAfterResolve = apiGet.mock.calls.filter(
      ([url]) => url === '/adminapi/users/abc123/',
    ).length;
    expect(callsAfterResolve).toBe(callsBeforeResolve);
    expect(screen.getByText('第二位使用者')).toBeInTheDocument();
    expect(screen.queryByText('王小明')).not.toBeInTheDocument();
  });
});
