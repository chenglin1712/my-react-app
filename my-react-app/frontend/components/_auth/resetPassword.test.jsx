import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { getAuth, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import ResetPassword from './resetPassword';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
  updatePassword: vi.fn(),
  reauthenticateWithCredential: vi.fn(),
  EmailAuthProvider: { credential: vi.fn((email, pw) => ({ email, pw })) },
}));
vi.mock('lottie-web', () => ({
  default: { loadAnimation: vi.fn(() => ({ destroy: vi.fn() })) },
}));

const fillPasswords = (current, next) => {
  fireEvent.change(screen.getByLabelText('目前密碼'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('新密碼'), { target: { value: next } });
};

describe('ResetPassword (resetPassword)', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    updatePassword.mockReset();
    reauthenticateWithCredential.mockReset();
    EmailAuthProvider.credential.mockClear();
  });

  test('已登入時送出，會先用目前密碼重新驗證，再更新為新密碼', async () => {
    const fakeUser = { email: 'a@b.com' };
    getAuth.mockReturnValue({ currentUser: fakeUser });
    reauthenticateWithCredential.mockResolvedValueOnce();
    updatePassword.mockResolvedValueOnce();

    render(<ResetPassword />);
    fillPasswords('oldpass', 'newpass123');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '變更密碼' }));
    });

    expect(EmailAuthProvider.credential).toHaveBeenCalledWith('a@b.com', 'oldpass');
    expect(reauthenticateWithCredential).toHaveBeenCalledWith(fakeUser, { email: 'a@b.com', pw: 'oldpass' });
    expect(updatePassword).toHaveBeenCalledWith(fakeUser, 'newpass123');
  });

  test.each([
    ['auth/wrong-password', '密碼錯誤，請再試一次。'],
    ['auth/invalid-credential', '密碼錯誤，請再試一次。'],
    ['auth/weak-password', '新密碼強度不足，請使用至少 6 個字元。'],
    ['auth/unknown', '密碼更新失敗'],
  ])('重新驗證失敗代碼 %s 顯示對應錯誤訊息，且不會卡住', async (code, expectedMessage) => {
    const fakeUser = { email: 'a@b.com' };
    getAuth.mockReturnValue({ currentUser: fakeUser });
    reauthenticateWithCredential.mockRejectedValueOnce({ code, message: 'boom' });

    render(<ResetPassword />);
    fillPasswords('wrongold', 'newpass123');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '變更密碼' }));
    });

    expect(screen.getByText(expectedMessage)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '變更密碼' })).not.toBeDisabled();
  });

  test('currentUser 為 null（未登入／token 過期）時不會呼叫 Firebase API，且會顯示錯誤而不是卡住', async () => {
    getAuth.mockReturnValue({ currentUser: null });

    render(<ResetPassword />);
    fillPasswords('oldpass', 'newpass123');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '變更密碼' }));
    });

    // user 為 null，存取 user.email 會同步丟出例外，被 try/catch 接住，
    // 不會呼叫任何 Firebase API，也不會讓畫面卡住不給任何提示。
    expect(reauthenticateWithCredential).not.toHaveBeenCalled();
    expect(updatePassword).not.toHaveBeenCalled();
    expect(screen.getByText('密碼更新失敗')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '變更密碼' })).not.toBeDisabled();
  });

  test('變更成功後顯示成功動畫，並在延遲後返回上一頁', async () => {
    vi.useFakeTimers();
    try {
      const fakeUser = { email: 'a@b.com' };
      getAuth.mockReturnValue({ currentUser: fakeUser });
      reauthenticateWithCredential.mockResolvedValueOnce();
      updatePassword.mockResolvedValueOnce();

      render(<ResetPassword />);
      fillPasswords('oldpass', 'newpass123');

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '變更密碼' }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByText(/密碼更新成功！將移至編輯資料頁面/)).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      expect(mockNavigate).toHaveBeenCalledWith(-1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('點擊取消會導向上一頁', () => {
    getAuth.mockReturnValue({ currentUser: { email: 'a@b.com' } });
    render(<ResetPassword />);
    fireEvent.click(screen.getByText('取消'));
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });
});
