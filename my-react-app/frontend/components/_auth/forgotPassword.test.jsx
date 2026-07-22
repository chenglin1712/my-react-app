import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { getAuth, sendPasswordResetEmail } from 'firebase/auth';
import Forgot from './forgotPassword';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

const AUTH_INSTANCE = { fake: 'auth-instance' };
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => AUTH_INSTANCE),
  sendPasswordResetEmail: vi.fn(),
}));

describe('Forgot (forgotPassword)', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    getAuth.mockClear();
    sendPasswordResetEmail.mockReset();
  });

  test('輸入 email 後送出，呼叫 sendPasswordResetEmail 並帶正確參數', async () => {
    sendPasswordResetEmail.mockResolvedValueOnce();
    render(<Forgot />);
    fireEvent.change(screen.getByLabelText('電子郵件'), { target: { value: 'a@b.com' } });

    await act(async () => {
      fireEvent.click(screen.getByText('重設密碼'));
    });

    expect(sendPasswordResetEmail).toHaveBeenCalledWith(AUTH_INSTANCE, 'a@b.com');
  });

  test('寄送成功顯示成功訊息', async () => {
    sendPasswordResetEmail.mockResolvedValueOnce();
    render(<Forgot />);
    fireEvent.change(screen.getByLabelText('電子郵件'), { target: { value: 'a@b.com' } });

    await act(async () => {
      fireEvent.click(screen.getByText('重設密碼'));
    });

    const message = screen.getByText('已寄送密碼重設信件，請至信箱確認。');
    expect(message).toHaveClass('success');
  });

  test.each([
    ['auth/invalid-email', 'Email 格式不正確'],
    ['auth/user-not-found', '找不到此 Email 對應的帳號'],
    ['auth/unknown-error', '寄送失敗'],
  ])('錯誤代碼 %s 顯示對應訊息，且不會卡住無法重試', async (code, expectedMessage) => {
    sendPasswordResetEmail.mockRejectedValueOnce({ code, message: 'boom' });
    render(<Forgot />);
    fireEvent.change(screen.getByLabelText('電子郵件'), { target: { value: 'a@b.com' } });

    await act(async () => {
      fireEvent.click(screen.getByText('重設密碼'));
    });

    const message = screen.getByText(expectedMessage);
    expect(message).toHaveClass('error');
    // 失敗後按鈕仍可點擊，能夠再次嘗試送出
    expect(screen.getByText('重設密碼')).not.toBeDisabled();
  });

  test('點擊取消會導向上一頁', () => {
    render(<Forgot />);
    fireEvent.click(screen.getByText('取消'));
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });
});
