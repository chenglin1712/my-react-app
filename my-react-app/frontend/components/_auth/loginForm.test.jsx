import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import LoginForm from './loginForm';

const mockNavigate = vi.fn();
// mockSearchParams 預設是空的（等同沒有 next 參數），個別測試可以在 render 前
// 重新指派這個變數的內容來模擬帶 ?next=... 的情境。
let mockSearchParams = new URLSearchParams();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [mockSearchParams],
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
    mockSearchParams = new URLSearchParams();
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

  test('非 Firebase 例外（沒有 code 欄位）不會在 catch 區塊內再丟一次，仍顯示通用錯誤訊息', async () => {
    signInWithEmailAndPassword.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<LoginForm />);
    fillLoginForm('a@b.com', 'secret1');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '登入' }));
    });

    expect(screen.getByText('登入失敗: Failed to fetch')).toBeInTheDocument();
  });

  test('忘記密碼連結有 href，鍵盤使用者可以直接 Tab 到並用 Enter 觸發導頁', () => {
    render(<LoginForm />);
    const forgotLink = screen.getByText('忘記密碼?');

    expect(forgotLink).toHaveAttribute('href', '/forgot');

    fireEvent.click(forgotLink);
    expect(mockNavigate).toHaveBeenCalledWith('/forgot');
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

  test('帶 next 參數登入成功後導向 next 指定的站內路徑（例如 AdminRoute 導來的 /admin）', async () => {
    mockSearchParams = new URLSearchParams('next=/admin');
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

      act(() => {
        vi.advanceTimersByTime(1800);
      });

      expect(mockNavigate).toHaveBeenCalledWith('/admin');
    } finally {
      vi.useRealTimers();
    }
  });

  test('next 是外部網址（開放重導向）時忽略它，導回首頁', async () => {
    mockSearchParams = new URLSearchParams('next=' + encodeURIComponent('//evil.example.com'));
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

      act(() => {
        vi.advanceTimersByTime(1800);
      });

      expect(mockNavigate).toHaveBeenCalledWith('/');
    } finally {
      vi.useRealTimers();
    }
  });

  test('next 用反斜線偽裝成站內路徑時仍會被擋下（瀏覽器會把 /\\evil.com 正規化成協定相對網址 //evil.com）', async () => {
    // 回歸測試：原本用 next.startsWith("/") && !next.startsWith("//") 判斷時，
    // "/\\evil.example.com" 會通過檢查（它就是單一個 "/" 開頭），但瀏覽器的
    // URL 解析器會把反斜線當成正斜線處理，實際上等同 "//evil.example.com"，
    // 導致真的跳到外部網站。改用 new URL() 解析後比對 origin 才能正確擋下。
    mockSearchParams = new URLSearchParams('next=' + encodeURIComponent('/\\evil.example.com'));
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

      act(() => {
        vi.advanceTimersByTime(1800);
      });

      expect(mockNavigate).toHaveBeenCalledWith('/');
    } finally {
      vi.useRealTimers();
    }
  });
});
