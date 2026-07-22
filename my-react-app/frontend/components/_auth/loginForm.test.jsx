import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import LoginForm from './loginForm';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn(),
}));
vi.mock('../../../firebase', () => ({
  auth: { fake: 'auth-instance' },
}));
vi.mock('lottie-web', () => ({
  default: { loadAnimation: vi.fn(() => ({ destroy: vi.fn() })) },
}));

const fillLoginForm = (email, password) => {
  fireEvent.change(screen.getByLabelText('帳號'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: password } });
};

describe('LoginForm', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    signInWithEmailAndPassword.mockReset();
  });

  test('email 或密碼為空時顯示驗證錯誤，不呼叫 signIn', () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    expect(screen.getByText('請輸入電子郵件和密碼！')).toBeInTheDocument();
    expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
  });

  test('輸入帳密後送出，呼叫 signInWithEmailAndPassword 並帶正確參數', async () => {
    signInWithEmailAndPassword.mockResolvedValueOnce({});
    render(<LoginForm />);
    fillLoginForm('a@b.com', 'secret1');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '登入' }));
    });

    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(
      { fake: 'auth-instance' },
      'a@b.com',
      'secret1',
    );
  });

  test('帳密錯誤（auth/invalid-credential）顯示專屬錯誤訊息，且不會卡住無法重試', async () => {
    signInWithEmailAndPassword.mockRejectedValueOnce({ code: 'auth/invalid-credential', message: 'bad' });
    render(<LoginForm />);
    fillLoginForm('a@b.com', 'wrongpass');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '登入' }));
    });

    expect(screen.getByText('帳號或密碼錯誤，請檢查電子郵件和密碼是否正確！')).toBeInTheDocument();
    // 錯誤發生後按鈕仍可點擊，不會卡在無法重試的狀態
    expect(screen.getByRole('button', { name: '登入' })).not.toBeDisabled();
  });

  test('其他錯誤代碼顯示帶原始訊息的錯誤文字', async () => {
    signInWithEmailAndPassword.mockRejectedValueOnce({ code: 'auth/network-request-failed', message: 'Network Error' });
    render(<LoginForm />);
    fillLoginForm('a@b.com', 'secret1');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '登入' }));
    });

    expect(screen.getByText('登入失敗: Network Error')).toBeInTheDocument();
  });

  test('登入成功後顯示成功動畫，並在延遲後導向首頁', async () => {
    vi.useFakeTimers();
    try {
      signInWithEmailAndPassword.mockResolvedValueOnce({});
      render(<LoginForm />);
      fillLoginForm('a@b.com', 'secret1');

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '登入' }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByText(/登入成功！您將移至首頁/)).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1800);
      });

      expect(mockNavigate).toHaveBeenCalledWith('/');
    } finally {
      vi.useRealTimers();
    }
  });
});
