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
} from '@testing-library/react';
import {
  MemoryRouter,
  Route,
  Routes,
} from 'react-router-dom';
import UserCreate from './UserCreate';
import { apiPost } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
  apiPost: vi.fn(),
}));

let mockRole = 'owner';

vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({
    userData: { role: mockRole },
    loading: false,
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/users/new']}>
      <Routes>
        <Route
          path="/admin/users/new"
          element={<UserCreate />}
        />
        <Route
          path="/admin/users/:uid"
          element={<div>使用者詳情頁</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function fillRequiredFields() {
  fireEvent.change(
    screen.getByLabelText(/Email/),
    { target: { value: 'new@example.com' } },
  );
  fireEvent.change(
    screen.getByLabelText(/^密碼/),
    { target: { value: 'secret123' } },
  );
  fireEvent.change(
    screen.getByLabelText(/姓名/),
    { target: { value: '王小明' } },
  );
}

describe('UserCreate', () => {
  beforeEach(() => {
    mockRole = 'owner';
    apiPost.mockReset();
    apiPost.mockResolvedValue({
      uid: 'new-user',
      email: 'new@example.com',
      email_verified: false,
      disabled: false,
      role: null,
      name: '王小明',
      identity: '學生',
      avatar_url: '',
    });
  });

  test('owner 可以建立使用者並在成功後前往詳情頁', async () => {
    renderPage();
    fillRequiredFields();

    fireEvent.change(
      screen.getByLabelText('身分'),
      { target: { value: '教師' } },
    );
    fireEvent.change(
      screen.getByLabelText('後台角色'),
      { target: { value: 'editor' } },
    );

    fireEvent.click(
      screen.getByRole('button', { name: '建立使用者' }),
    );

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/users/',
        {
          email: 'new@example.com',
          password: 'secret123',
          name: '王小明',
          identity: '教師',
          avatar_url: '',
          role: 'editor',
        },
      );
    });

    expect(
      await screen.findByText('使用者詳情頁'),
    ).toBeInTheDocument();
  });

  test('未指派角色時送出 null', async () => {
    renderPage();
    fillRequiredFields();

    fireEvent.click(
      screen.getByRole('button', { name: '建立使用者' }),
    );

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/users/',
        expect.objectContaining({
          role: null,
          identity: '學生',
          avatar_url: '',
        }),
      );
    });
  });

  test('admin 看不到角色欄位且送出 null', async () => {
    mockRole = 'admin';

    renderPage();

    expect(
      screen.queryByLabelText('後台角色'),
    ).not.toBeInTheDocument();

    fillRequiredFields();

    fireEvent.click(
      screen.getByRole('button', { name: '建立使用者' }),
    );

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/users/',
        expect.objectContaining({ role: null }),
      );
    });
  });

  test('可以切換顯示與隱藏密碼', () => {
    renderPage();

    const password = screen.getByLabelText(/^密碼/);
    expect(password).toHaveAttribute('type', 'password');

    fireEvent.click(
      screen.getByRole('button', { name: '顯示密碼' }),
    );

    expect(password).toHaveAttribute('type', 'text');
    expect(
      screen.getByRole('button', { name: '隱藏密碼' }),
    ).toBeInTheDocument();
  });

  test('頭像檔案超過 5 MB 時顯示錯誤且不上傳', () => {
    renderPage();

    const bigFile = new File(
      [new Uint8Array(6 * 1024 * 1024)],
      'avatar.png',
      { type: 'image/png' },
    );

    fireEvent.change(
      screen.getByLabelText('頭像'),
      { target: { files: [bigFile] } },
    );

    expect(
      screen.getByText('圖片不得超過 5 MB，請重新選擇。'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('頭像上傳中……'),
    ).not.toBeInTheDocument();
  });

  test('API 失敗時顯示錯誤訊息', async () => {
    apiPost.mockRejectedValueOnce(
      new Error('這個 email 已經被使用'),
    );

    renderPage();
    fillRequiredFields();

    fireEvent.click(
      screen.getByRole('button', { name: '建立使用者' }),
    );

    expect(
      await screen.findByText('這個 email 已經被使用'),
    ).toBeInTheDocument();
  });

  test('沒有帳號管理權限時不顯示建立表單', () => {
    mockRole = 'editor';

    renderPage();

    expect(
      screen.getByText('目前帳號沒有新增使用者的權限。'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '建立使用者' }),
    ).not.toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });
});
