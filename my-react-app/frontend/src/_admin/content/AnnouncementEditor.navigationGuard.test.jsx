// 公告編輯器在 data router（正式入口的結構：path: '*' + 巢狀 <Routes>）底下的站內換頁攔截。
// 其餘行為見 AnnouncementEditor.test.jsx（那邊用 MemoryRouter，只會有 beforeunload）。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, Route, RouterProvider, Routes, createMemoryRouter } from 'react-router-dom';

import AnnouncementEditor from './AnnouncementEditor';
import { apiGet, apiPatch, apiPost } from '../../../utils/apiClient';

vi.mock('@utils/uploadToCloudinary', () => ({ uploadToCloudinary: vi.fn() }));
vi.mock('../../../utils/apiClient', () => ({
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    apiPatch: vi.fn(),
}));
vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({ userData: { role: 'owner' }, loading: false }),
}));

function renderInDataRouter() {
    const router = createMemoryRouter([{
        path: '*',
        element: (
            <>
                <Link to="/admin/content/announcements">回公告列表</Link>
                <Routes>
                    <Route path="/admin/content/announcements" element={<p>公告列表內容</p>} />
                    <Route path="/admin/content/announcements/new" element={<AnnouncementEditor />} />
                    <Route path="/admin/content/announcements/:id" element={<AnnouncementEditor />} />
                </Routes>
            </>
        ),
    }], { initialEntries: ['/admin/content/announcements/new'] });
    render(<RouterProvider router={router} />);
    return router;
}

beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
});

afterEach(async () => {
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

describe('AnnouncementEditor：站內換頁的未儲存攔截', () => {
    test('有未儲存內容時點站內連結會先詢問，取消後留在編輯頁', async () => {
        const router = renderInDataRouter();
        fireEvent.change(screen.getByLabelText(/標題/), { target: { value: '尚未儲存的公告' } });

        fireEvent.click(screen.getByRole('link', { name: '回公告列表' }));
        expect(await screen.findByRole('dialog', { name: '尚未儲存的變更' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '繼續編輯' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(router.state.location.pathname).toBe('/admin/content/announcements/new');
        expect(screen.getByDisplayValue('尚未儲存的公告')).toBeInTheDocument();
    });

    test('新公告建立成功後換到自己的網址，不會被自己的未儲存保護攔下', async () => {
        apiPost.mockResolvedValueOnce({ id: 99, status: 'draft', updated_at: '2026-08-01T00:00:00Z' });
        const router = renderInDataRouter();
        fireEvent.change(screen.getByLabelText(/標題/), { target: { value: '新公告' } });

        fireEvent.click(screen.getByRole('button', { name: /^儲存$/ }));

        await waitFor(() => expect(router.state.location.pathname).toBe('/admin/content/announcements/99'));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
