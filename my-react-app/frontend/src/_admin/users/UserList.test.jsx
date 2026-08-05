import {
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UserList from './UserList';
import { apiGet } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(),
}));

let mockRole = 'owner';

vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({
    userData: { role: mockRole },
    loading: false,
  }),
}));

const users = [
  {
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
  },
  {
    uid: 'normal-user',
    email: 'normal@example.com',
    email_verified: false,
    disabled: true,
    role: null,
    name: null,
    identity: null,
    avatar_url: null,
    join_date: null,
    created_at: null,
    last_sign_in_at: null,
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <UserList />
    </MemoryRouter>,
  );
}

describe('UserList', () => {
  beforeEach(() => {
    mockRole = 'owner';
    apiGet.mockReset();
    apiGet.mockResolvedValue({
      results: users,
      count: 2,
      page: 1,
      page_size: 20,
    });
  });

  test('載入後顯示使用者、角色與帳號狀態', async () => {
    renderPage();

    expect(await screen.findByText('王小明')).toBeInTheDocument();
    expect(screen.getByText('user@example.com')).toBeInTheDocument();

    const firstRow = screen.getByText('王小明').closest('tr');
    expect(within(firstRow).getByText('內容編輯')).toBeInTheDocument();
    expect(within(firstRow).getByText('正常')).toBeInTheDocument();
    expect(within(firstRow).getByText('學生')).toBeInTheDocument();

    const secondRow = screen.getByText('normal-user').closest('tr');
    expect(
      within(secondRow).getByText('一般使用者'),
    ).toBeInTheDocument();
    expect(within(secondRow).getByText('已停權')).toBeInTheDocument();
  });

  test('詳情按鈕連到對應 UID 的頁面', async () => {
    renderPage();

    const row = await screen
      .findByText('王小明')
      .then((element) => element.closest('tr'));

    expect(
      within(row).getByRole('button', { name: /詳情/ }),
    ).toHaveAttribute('href', '/admin/users/abc123');
  });

  test.each(['owner', 'admin'])(
    '%s 可以看到新增使用者按鈕',
    async (role) => {
      mockRole = role;

      renderPage();
      await screen.findByText('王小明');

      expect(
        screen.getByRole('button', { name: /新增使用者/ }),
      ).toHaveAttribute('href', '/admin/users/new');
    },
  );

  test.each(['editor', 'reviewer', 'analyst'])(
    '%s 看不到新增使用者按鈕',
    async (role) => {
      mockRole = role;

      renderPage();
      await screen.findByText('王小明');

      expect(
        screen.queryByRole('button', { name: /新增使用者/ }),
      ).not.toBeInTheDocument();
    },
  );

  test('送出篩選後以完整條件重新查詢', async () => {
    renderPage();
    await screen.findByText('王小明');

    fireEvent.change(
      screen.getByLabelText('關鍵字搜尋'),
      { target: { value: 'user@example.com' } },
    );
    fireEvent.change(
      screen.getByLabelText('角色'),
      { target: { value: 'editor' } },
    );
    fireEvent.change(
      screen.getByLabelText('身分'),
      { target: { value: '學生' } },
    );
    fireEvent.change(
      screen.getByLabelText('帳號狀態'),
      { target: { value: 'true' } },
    );
    fireEvent.click(
      screen.getByRole('button', { name: '搜尋' }),
    );

    await waitFor(() => {
      const [url] = apiGet.mock.calls.at(-1);
      expect(url).toContain('keyword=user%40example.com');
      expect(url).toContain('role=editor');
      expect(url).toContain('%E5%AD%B8%E7%94%9F');
      expect(url).toContain('disabled=true');
      expect(url).toContain('page=1');
      expect(url).toContain('page_size=20');
    });
  });

  test('下一頁按鈕會查詢下一頁', async () => {
    apiGet.mockResolvedValue({
      results: users,
      count: 25,
      page: 1,
      page_size: 20,
    });

    renderPage();
    await screen.findByText('王小明');

    fireEvent.click(
      screen.getByRole('button', { name: '下一頁' }),
    );

    await waitFor(() => {
      const [url] = apiGet.mock.calls.at(-1);
      expect(url).toContain('page=2');
    });
  });

  test('非 STAFF_ROLES 不呼叫 API 並顯示權限訊息', () => {
    mockRole = null;

    renderPage();

    expect(
      screen.getByText('目前帳號沒有檢視使用者管理頁面的權限。'),
    ).toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalled();
  });

  test('API 失敗時顯示錯誤訊息', async () => {
    apiGet.mockRejectedValueOnce(new Error('使用者列表載入失敗'));

    renderPage();

    expect(
      await screen.findByText('使用者列表載入失敗'),
    ).toBeInTheDocument();
  });
});
