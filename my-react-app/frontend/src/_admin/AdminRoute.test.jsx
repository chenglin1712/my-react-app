import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import AdminRoute from './AdminRoute';
import { clearAdminSession, markAdminSession } from './session/adminSession';

const mockUseAuth = vi.fn();
vi.mock('../userServives/authContext', () => ({ useAuth: () => mockUseAuth() }));

const LocationProbe = () => {
    const location = useLocation();
    return <div data-testid="where">{location.pathname + location.search}</div>;
};

const renderAt = (path) => render(
    <MemoryRouter initialEntries={[path]}>
        <Routes>
            <Route path="/admin/*" element={<AdminRoute><div>後台內容</div></AdminRoute>} />
            <Route path="/admin-login" element={<LocationProbe />} />
            <Route path="/" element={<LocationProbe />} />
        </Routes>
    </MemoryRouter>,
);

describe('AdminRoute', () => {
    beforeEach(() => clearAdminSession());

    test('登入狀態還在確認時顯示入口載入畫面，不是空白', () => {
        mockUseAuth.mockReturnValue({ userData: null, loading: true });
        renderAt('/admin');
        expect(screen.getByRole('status')).toHaveTextContent('正在確認工作階段');
        expect(screen.queryByText('後台內容')).not.toBeInTheDocument();
    });

    test('未登入導向登入頁並帶回原路徑', () => {
        mockUseAuth.mockReturnValue({ userData: null, loading: false });
        renderAt('/admin/users');
        expect(screen.getByTestId('where')).toHaveTextContent('/admin-login?next=%2Fadmin%2Fusers');
    });

    test('已登入但不是後台角色時回首頁，不顯示後台', () => {
        mockUseAuth.mockReturnValue({ userData: { role: 'user' }, loading: false });
        renderAt('/admin');
        expect(screen.getByTestId('where')).toHaveTextContent('/');
        expect(screen.queryByText('後台內容')).not.toBeInTheDocument();
    });

    test('後台角色已在後台登入頁輸入過密碼時可進入', () => {
        mockUseAuth.mockReturnValue({ userData: { uid: 'u1', role: 'owner' }, loading: false });
        markAdminSession('u1');
        renderAt('/admin');
        expect(screen.getByText('後台內容')).toBeInTheDocument();
    });

    test('前台已登入的後台角色，沒有輸入過後台密碼時要先到後台登入頁', () => {
        mockUseAuth.mockReturnValue({ userData: { uid: 'u1', role: 'owner' }, loading: false });
        renderAt('/admin/users');
        expect(screen.getByTestId('where')).toHaveTextContent('/admin-login?next=%2Fadmin%2Fusers');
        expect(screen.queryByText('後台內容')).not.toBeInTheDocument();
    });

    test('旗標是別的帳號留下的就不算數', () => {
        mockUseAuth.mockReturnValue({ userData: { uid: 'u2', role: 'owner' }, loading: false });
        markAdminSession('u1');
        renderAt('/admin');
        expect(screen.getByTestId('where')).toHaveTextContent('/admin-login');
    });
});
