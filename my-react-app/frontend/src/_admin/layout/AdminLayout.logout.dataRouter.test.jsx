// WP-8 追加：編輯頁有未儲存內容時按側邊欄「登出」。
// 用 data router（createMemoryRouter + RouterProvider，與正式入口同一套機制），編輯頁的 useBlocker 才會真的生效；
// 外層包 AdminRoute，模擬 signOut 讓 auth 狀態變成 null 時 AdminRoute 重新渲染、自己導頁的情況。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { Link, Route, RouterProvider, Routes, createMemoryRouter } from 'react-router-dom';

import AdminRoute from '../AdminRoute';
import AdminLayout from './AdminLayout';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { clearAdminSession, isAdminLogoutInProgress, markAdminSession } from '../session/adminSession';

// 可變的 auth 狀態：signOut 時把使用者清掉並通知訂閱者，就像 Firebase 的 onAuthStateChanged
const authStore = (() => {
    let state = null;
    const listeners = new Set();
    return {
        get: () => state,
        set: (next) => { state = next; listeners.forEach((listener) => listener()); },
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    };
})();

vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({ userData: useSyncExternalStore(authStore.subscribe, authStore.get), loading: false }),
}));
const mockSignOut = vi.fn();
vi.mock('../../userServives/userServive', () => ({ signOut: (...args) => mockSignOut(...args) }));

const DIALOG_NAME = '尚未儲存的變更';

function Editor() {
    useUnsavedChangesGuard(true);
    return (
        <div>
            <p>EDITOR_CONTENT</p>
            <Link to="/admin/other">其他後台頁</Link>
        </div>
    );
}

function renderAdmin() {
    const router = createMemoryRouter([{
        path: '*',
        element: (
            <Routes>
                <Route path="/admin/*" element={(
                    <AdminRoute>
                        <Routes>
                            <Route element={<AdminLayout />}>
                                <Route path="edit" element={<Editor />} />
                                <Route path="other" element={<p>OTHER_CONTENT</p>} />
                            </Route>
                        </Routes>
                    </AdminRoute>
                )} />
                <Route path="/admin-login" element={<p>ADMIN_LOGIN</p>} />
                <Route path="/" element={<p>HOME</p>} />
            </Routes>
        ),
    }], { initialEntries: ['/admin/edit'] });
    render(<RouterProvider router={router} />);
    return router;
}

const clickLogout = (user) => user.click(screen.getByRole('button', { name: '登出' }));

beforeEach(() => {
    authStore.set({ uid: 'u1', role: 'owner', firestoreData: null });
    markAdminSession('u1');
    mockSignOut.mockReset();
    // 與 Firebase 相同：auth 狀態的通知比 signOut() 的 promise 先到
    mockSignOut.mockImplementation(async () => { authStore.set(null); });
});

afterEach(async () => {
    clearAdminSession();
    // confirmAction 卸載自己的容器用了 setTimeout(0)；等它清乾淨，下一個測試才不會看到殘留的視窗
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

describe('AdminLayout 登出：有未儲存內容時（data router）', () => {
    test('先出現確認視窗，按「繼續編輯」就不登出、留在編輯頁', async () => {
        const user = userEvent.setup();
        const router = renderAdmin();

        await clickLogout(user);
        await screen.findByRole('dialog', { name: DIALOG_NAME });
        expect(mockSignOut).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: '繼續編輯' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(mockSignOut).not.toHaveBeenCalled();
        expect(router.state.location.pathname).toBe('/admin/edit');
        expect(screen.getByText('EDITOR_CONTENT')).toBeInTheDocument();
        expect(isAdminLogoutInProgress()).toBe(false);
    });

    test('確認後才登出，直接回前台首頁：不被編輯頁攔下、不導去後台登入頁、不殘留確認視窗', async () => {
        const user = userEvent.setup();
        const router = renderAdmin();

        await clickLogout(user);
        await screen.findByRole('dialog', { name: DIALOG_NAME });
        await user.click(screen.getByRole('button', { name: '放棄變更並離開' }));

        expect(await screen.findByText('HOME')).toBeInTheDocument();
        expect(mockSignOut).toHaveBeenCalledTimes(1);
        expect(router.state.location.pathname).toBe('/');
        expect(screen.queryByText('ADMIN_LOGIN')).not.toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        // AdminRoute 卸載時清掉「正在登出」旗標，之後沒登入就進後台照常導去登入頁
        expect(isAdminLogoutInProgress()).toBe(false);
        // 等一下，確認沒有遲到的導頁或視窗冒出來
        await new Promise((resolve) => { setTimeout(resolve, 20); });
        expect(router.state.location.pathname).toBe('/');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('auth 狀態在 signOut() 完成之後才通知時，一樣回首頁', async () => {
        mockSignOut.mockImplementation(async () => {
            setTimeout(() => authStore.set(null), 0);
        });
        const user = userEvent.setup();
        const router = renderAdmin();

        await clickLogout(user);
        await screen.findByRole('dialog', { name: DIALOG_NAME });
        await user.click(screen.getByRole('button', { name: '放棄變更並離開' }));

        expect(await screen.findByText('HOME')).toBeInTheDocument();
        await new Promise((resolve) => { setTimeout(resolve, 20); });
        expect(router.state.location.pathname).toBe('/');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('確認後登出失敗：留在編輯頁顯示錯誤，編輯頁的離開保護恢復', async () => {
        mockSignOut.mockRejectedValue(new Error('network'));
        const user = userEvent.setup();
        const router = renderAdmin();

        await clickLogout(user);
        await screen.findByRole('dialog', { name: DIALOG_NAME });
        await user.click(screen.getByRole('button', { name: '放棄變更並離開' }));

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('登出失敗'));
        expect(router.state.location.pathname).toBe('/admin/edit');
        expect(isAdminLogoutInProgress()).toBe(false);
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

        // 放行已經收回：之後點站內連結照樣會詢問
        await user.click(screen.getByRole('link', { name: '其他後台頁' }));
        await screen.findByRole('dialog', { name: DIALOG_NAME });
        expect(router.state.location.pathname).toBe('/admin/edit');
        await user.click(screen.getByRole('button', { name: '繼續編輯' }));
    });

    test('沒有登出時，工作階段失效（auth 變成 null）仍導去後台登入頁並帶 next', async () => {
        const router = renderAdmin();
        authStore.set(null);
        expect(await screen.findByText('ADMIN_LOGIN')).toBeInTheDocument();
        expect(router.state.location.pathname).toBe('/admin-login');
        expect(router.state.location.search).toBe('?next=%2Fadmin%2Fedit');
    });
});
