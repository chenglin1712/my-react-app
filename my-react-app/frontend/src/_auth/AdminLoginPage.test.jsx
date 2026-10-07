import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminLoginPage from './AdminLoginPage';

let mockCurrentUser = null;
vi.mock('../../../firebase', () => ({
    auth: { get currentUser() { return mockCurrentUser; } },
}));
vi.mock('../userServives/authContext', () => ({ useAuth: () => ({ userData: null, loading: false }) }));
vi.mock('firebase/auth', () => ({ signInWithEmailAndPassword: vi.fn() }));
vi.mock('lottie-web', () => ({ default: { loadAnimation: vi.fn(() => ({ destroy: vi.fn() })) } }));

const renderPage = () => render(<MemoryRouter><AdminLoginPage /></MemoryRouter>);

describe('AdminLoginPage', () => {
    beforeEach(() => { mockCurrentUser = null; });

    test('顯示後台專用登入表單，沒有註冊入口', () => {
        renderPage();
        expect(screen.getByRole('heading', { name: '管理員登入' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '登入後台' })).toBeInTheDocument();
        expect(screen.queryByText('註冊')).not.toBeInTheDocument();
        expect(screen.queryByRole('note')).not.toBeInTheDocument();
    });

    test('前台已登入時說明為什麼要再輸入密碼，並預填信箱', () => {
        mockCurrentUser = { email: 'staff@example.com' };
        renderPage();
        expect(screen.getByRole('note')).toHaveTextContent('staff@example.com');
        expect(screen.getByRole('note')).toHaveTextContent('再輸入一次密碼');
        expect(screen.getByLabelText('帳號')).toHaveValue('staff@example.com');
    });

    test('左側裝飾對輔助科技隱藏，標語文字不會被朗讀成內容', () => {
        const { container } = renderPage();
        expect(container.querySelector('.admin-login-aside')).toHaveAttribute('aria-hidden', 'true');
    });
});
