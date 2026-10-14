import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { registerWithImg } from '../../src/userServives/userServive';
import RegisterForm from './registerForm';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));
vi.mock('../../src/userServives/userServive', () => ({
  registerWithImg: vi.fn(),
}));
const mockUpdateUserData = vi.fn();
vi.mock('../../src/userServives/authContext', () => ({
  useAuth: () => ({ updateUserData: mockUpdateUserData }),
}));
vi.mock('lottie-web', () => ({
  default: { loadAnimation: vi.fn(() => ({ destroy: vi.fn() })) },
}));

const fillRequiredFields = () => {
  fireEvent.change(screen.getByLabelText('使用者名稱'), { target: { value: '小明' } });
  fireEvent.change(screen.getByLabelText('電子郵件'), { target: { value: 'a@b.com' } });
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'secret1' } });
  fireEvent.change(screen.getByLabelText('確認密碼'), { target: { value: 'secret1' } });
};

describe('RegisterForm', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    registerWithImg.mockReset();
    mockUpdateUserData.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  test('密碼規則清單用文字寫出「未符合／已符合」，不只靠顏色，並綁給密碼欄位', () => {
    render(<RegisterForm />);
    const passwordInput = screen.getByLabelText('密碼');
    const rules = screen.getByRole('list', { name: '密碼規則' });

    fireEvent.change(passwordInput, { target: { value: '123' } });
    expect(rules).toHaveTextContent('至少 6 個字元');
    expect(rules).toHaveTextContent('未符合');
    expect(rules).not.toHaveTextContent('已符合');
    expect(passwordInput).toHaveAccessibleDescription(/至少 6 個字元/);

    fireEvent.change(passwordInput, { target: { value: '123456' } });
    expect(rules).toHaveTextContent('已符合');
    expect(rules).not.toHaveTextContent('未符合');
  });

  test('沒有只有「學生」一個選項的身分下拉，但仍以「學生」寫進使用者資料', async () => {
    registerWithImg.mockResolvedValueOnce();
    render(<RegisterForm />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fillRequiredFields();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '註冊' }));
    });
    expect(registerWithImg.mock.calls[0][3]).toBe('學生');
  });

  test('欄位留空送出：錯誤顯示在各欄位下方，焦點移到第一個有問題的欄位', async () => {
    render(<RegisterForm />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '註冊' }));
    });

    expect(screen.getByLabelText('使用者名稱')).toHaveAccessibleDescription('請輸入使用者名稱');
    expect(screen.getByLabelText('電子郵件')).toHaveAccessibleDescription('請輸入電子郵件');
    expect(screen.getByLabelText('使用者名稱')).toHaveFocus();
    expect(registerWithImg).not.toHaveBeenCalled();
  });

  test('密碼未滿 6 個字元送出：錯誤在密碼欄位下方，不呼叫註冊', async () => {
    render(<RegisterForm />);
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('密碼'), { target: { value: '123' } });
    fireEvent.change(screen.getByLabelText('確認密碼'), { target: { value: '123' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '註冊' }));
    });

    expect(screen.getByLabelText('密碼')).toHaveAccessibleDescription(/密碼至少需要 6 個字元/);
    expect(registerWithImg).not.toHaveBeenCalled();
  });

  test('填寫欄位後送出，呼叫 registerWithImg 並帶正確參數（預設身分/無頭像）', async () => {
    registerWithImg.mockResolvedValueOnce();
    render(<RegisterForm />);
    fillRequiredFields();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '註冊' }));
    });

    expect(registerWithImg).toHaveBeenCalledWith('小明', 'a@b.com', 'secret1', '學生', null);
  });

  test('兩次密碼不一致時顯示提示，且不會送出註冊', async () => {
    render(<RegisterForm />);
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('確認密碼'), { target: { value: 'different' } });
    // 打字途中不提示；離開欄位後才在欄位下方顯示
    expect(screen.queryByText('兩次輸入的密碼不一致')).not.toBeInTheDocument();
    fireEvent.blur(screen.getByLabelText('確認密碼'));
    expect(screen.getByLabelText('確認密碼')).toHaveAccessibleDescription('兩次輸入的密碼不一致');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '註冊' }));
    });

    expect(registerWithImg).not.toHaveBeenCalled();
  });

  test('註冊失敗（email 已被使用）顯示對應錯誤訊息，且不會卡住無法重試', async () => {
    registerWithImg.mockRejectedValueOnce({ code: 'auth/email-already-in-use', message: 'x' });
    render(<RegisterForm />);
    fillRequiredFields();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '註冊' }));
    });

    // 能對應到欄位的錯誤放在該欄位下方
    expect(screen.getByLabelText('電子郵件')).toHaveAccessibleDescription('這個電子郵件已經註冊過');
    expect(screen.getByRole('button', { name: '註冊' })).not.toBeDisabled();
  });

  test('註冊失敗（其他原因）顯示通用錯誤訊息', async () => {
    registerWithImg.mockRejectedValueOnce({ code: 'auth/unknown', message: 'boom' });
    render(<RegisterForm />);
    fillRequiredFields();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '註冊' }));
    });

    expect(screen.getByText('註冊失敗，請稍後再試')).toBeInTheDocument();
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
  });

  test('註冊成功後直接登入：更新全站使用者資料，顯示成功動畫，並在延遲後導向首頁（不再要求手動登入）', async () => {
    vi.useFakeTimers();
    try {
      registerWithImg.mockResolvedValueOnce({ uid: 'u1', firestoreData: { name: '小明' } });
      render(<RegisterForm />);
      fillRequiredFields();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '註冊' }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByText(/註冊成功！您將移至首頁/)).toBeInTheDocument();
      expect(mockUpdateUserData).toHaveBeenCalledWith({ firestoreData: { name: '小明' }, uid: 'u1', role: null });
      expect(mockNavigate).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(800);
      });

      expect(mockNavigate).toHaveBeenCalledWith('/');
    } finally {
      vi.useRealTimers();
    }
  });

  test('必填欄位留空時不呼叫 registerWithImg', async () => {
    render(<RegisterForm />);
    // 故意不填任何必填欄位

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '註冊' }));
    });

    expect(registerWithImg).not.toHaveBeenCalled();
  });

  test('大頭貼預覽圖有 alt 文字', () => {
    render(<RegisterForm />);
    expect(screen.getByAltText('使用者頭像預覽')).toBeInTheDocument();
  });

  test('上傳圖片超過 5MB 時顯示錯誤，不會呼叫上傳 API', () => {
    render(<RegisterForm />);
    const bigFile = new File(['x'.repeat(10)], 'big.png', { type: 'image/png' });
    Object.defineProperty(bigFile, 'size', { value: 6 * 1024 * 1024 });

    fireEvent.change(screen.getByLabelText('大頭貼（選填）'), { target: { files: [bigFile] } });

    expect(screen.getByText('圖片不得超過 5 MB，請重新選擇。')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('上傳圖片成功後，送出會帶上取得的 avatarUrl', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ secure_url: 'https://cdn.example.com/avatar.png' }),
    });
    registerWithImg.mockResolvedValueOnce();
    render(<RegisterForm />);
    const file = new File(['x'], 'ok.png', { type: 'image/png' });

    await act(async () => {
      fireEvent.change(screen.getByLabelText('大頭貼（選填）'), { target: { files: [file] } });
    });
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    fillRequiredFields();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '註冊' }));
    });

    expect(registerWithImg).toHaveBeenCalledWith(
      '小明',
      'a@b.com',
      'secret1',
      '學生',
      'https://cdn.example.com/avatar.png',
    );
  });

  test('沒有假的「訪客登入」按鈕，點註冊頁任何按鈕都不會跳 alert', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<RegisterForm />);
    expect(screen.queryByRole('button', { name: /訪客登入/ })).not.toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('註冊按鈕下方有資料使用說明，連到隱私與資料並另開新視窗', () => {
    render(<RegisterForm />);
    const link = screen.getByRole('link', { name: /隱私與資料/ });
    expect(link).toHaveAttribute('href', '/privacy');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByRole('link', { name: /另開新視窗/ })).toBe(link);
    expect(screen.getByText(/我們如何使用你的資料，請見/)).toBeInTheDocument();
    // 沒有條款頁，措辭只告知、不主張「註冊即同意」
    expect(screen.queryByText(/註冊即/)).not.toBeInTheDocument();
  });
});

describe('RegisterForm 重複送出與確認密碼提示', () => {
  beforeEach(() => {
    registerWithImg.mockReset();
    mockNavigate.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  test('連續觸發兩次 submit 只會註冊一次（同步送出鎖）', async () => {
    let resolveRegister;
    registerWithImg.mockImplementation(() => new Promise((resolve) => { resolveRegister = resolve; }));
    render(<RegisterForm />);
    fillRequiredFields();
    const form = screen.getByLabelText('密碼').closest('form');

    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(registerWithImg).toHaveBeenCalledTimes(1);

    await act(async () => { resolveRegister(); });
  });

  test('確認密碼不一致的提示在離開欄位時即時朗讀（role=alert）；送出時改由焦點與 aria-describedby 念，不重複', async () => {
    render(<RegisterForm />);
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('確認密碼'), { target: { value: 'different' } });
    fireEvent.blur(screen.getByLabelText('確認密碼'));
    expect(screen.getByRole('alert')).toHaveTextContent('兩次輸入的密碼不一致');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '註冊' }));
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('確認密碼')).toHaveAccessibleDescription('兩次輸入的密碼不一致');
  });

  test('email 前後空白會先去掉再送出', async () => {
    registerWithImg.mockResolvedValueOnce();
    render(<RegisterForm />);
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('電子郵件'), { target: { value: '  a@b.com  ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '註冊' }));
    });
    expect(registerWithImg.mock.calls[0][1]).toBe('a@b.com');
  });
});
