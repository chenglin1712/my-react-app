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
vi.mock('lottie-web', () => ({
  default: { loadAnimation: vi.fn(() => ({ destroy: vi.fn() })) },
}));

const fillRequiredFields = () => {
  fireEvent.change(screen.getByLabelText('使用者名稱'), { target: { value: '小明' } });
  fireEvent.change(screen.getByLabelText('帳號'), { target: { value: 'a@b.com' } });
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'secret1' } });
};

describe('RegisterForm', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    registerWithImg.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  test('密碼未滿 6 個字元時顯示 invalid 提示，滿 6 個字元後變成 valid', () => {
    const { container } = render(<RegisterForm />);
    const passwordInput = screen.getByLabelText('密碼');

    fireEvent.change(passwordInput, { target: { value: '123' } });
    expect(container.querySelector('.check-icon')).toHaveClass('invalid');

    fireEvent.change(passwordInput, { target: { value: '123456' } });
    expect(container.querySelector('.check-icon')).toHaveClass('valid');
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

  test('註冊失敗（email 已被使用）顯示對應錯誤訊息，且不會卡住無法重試', async () => {
    registerWithImg.mockRejectedValueOnce({ code: 'auth/email-already-in-use', message: 'x' });
    render(<RegisterForm />);
    fillRequiredFields();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '註冊' }));
    });

    expect(screen.getByText('Email 已被註冊過')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '註冊' })).not.toBeDisabled();
  });

  test('註冊失敗（其他原因）顯示通用錯誤訊息', async () => {
    registerWithImg.mockRejectedValueOnce({ code: 'auth/unknown', message: 'boom' });
    render(<RegisterForm />);
    fillRequiredFields();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '註冊' }));
    });

    expect(screen.getByText('註冊失敗')).toBeInTheDocument();
  });

  test('註冊成功後顯示成功動畫，並在延遲後導向登入頁', async () => {
    vi.useFakeTimers();
    try {
      registerWithImg.mockResolvedValueOnce();
      render(<RegisterForm />);
      fillRequiredFields();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '註冊' }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByText(/註冊成功！您將移至登入頁面/)).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      expect(mockNavigate).toHaveBeenCalledWith('/login');
    } finally {
      vi.useRealTimers();
    }
  });

  test('上傳圖片超過 5MB 時顯示錯誤，不會呼叫上傳 API', () => {
    render(<RegisterForm />);
    const bigFile = new File(['x'.repeat(10)], 'big.png', { type: 'image/png' });
    Object.defineProperty(bigFile, 'size', { value: 6 * 1024 * 1024 });

    fireEvent.change(screen.getByLabelText('上傳大頭貼'), { target: { files: [bigFile] } });

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
      fireEvent.change(screen.getByLabelText('上傳大頭貼'), { target: { files: [file] } });
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
});
