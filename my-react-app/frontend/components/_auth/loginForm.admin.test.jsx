import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import LoginForm from './loginForm';
import { hasAdminSession, markAdminSession } from '../../src/_admin/session/adminSession';

const mockNavigate = vi.fn();
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

describe('LoginForm（後台專用登入頁版本）', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    signInWithEmailAndPassword.mockReset();
    mockSearchParams = new URLSearchParams();
    vi.useRealTimers();
  });

  test('只改呈現：沒有「登入」標題與註冊入口，按鈕文案是「登入後台」', () => {
    render(<LoginForm variant="admin" />);

    expect(screen.queryByRole('heading', { name: '登入' })).not.toBeInTheDocument();
    expect(screen.queryByText('註冊')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登入後台' })).toBeInTheDocument();
    expect(screen.getByText('忘記密碼?')).toBeInTheDocument();
  });

  test('一般會員版本不受影響：仍有標題、註冊入口與「登入」按鈕', () => {
    render(<LoginForm />);

    expect(screen.getByRole('heading', { name: '登入' })).toBeInTheDocument();
    expect(screen.getByText('註冊')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登入' })).toBeInTheDocument();
  });

  test('登入邏輯與一般版本相同：同源的 next 導回原目的地，外站的 next 退回首頁', async () => {
    vi.useFakeTimers();
    signInWithEmailAndPassword.mockResolvedValue({});

    mockSearchParams = new URLSearchParams({ next: '/admin/users' });
    const first = render(<LoginForm variant="admin" />);
    fireEvent.change(screen.getByLabelText('帳號'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'secret1' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '登入後台' })); });
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(mockNavigate).toHaveBeenLastCalledWith('/admin/users');
    first.unmount();

    mockSearchParams = new URLSearchParams({ next: 'https://evil.example/admin' });
    render(<LoginForm variant="admin" />);
    fireEvent.change(screen.getByLabelText('帳號'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'secret1' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '登入後台' })); });
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(mockNavigate).toHaveBeenLastCalledWith('/');
  });

  test('前台登入會作廢殘留的後台旗標；後台登入才會寫入旗標', async () => {
    const submit = async (name) => {
      fireEvent.change(screen.getByLabelText('帳號'), { target: { value: 'a@b.com' } });
      fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'secret1' } });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
    };
    signInWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u1' } });

    markAdminSession('u1');
    const member = render(<LoginForm />);
    await submit('登入');
    expect(hasAdminSession('u1')).toBe(false);
    member.unmount();

    render(<LoginForm variant="admin" />);
    await submit('登入後台');
    expect(hasAdminSession('u1')).toBe(true);
    window.sessionStorage.clear();
  });
});
