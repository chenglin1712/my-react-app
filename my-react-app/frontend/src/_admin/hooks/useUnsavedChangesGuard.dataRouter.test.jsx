// data router（createMemoryRouter + RouterProvider，與正式入口 createBrowserRouter 同一套機制）底下的
// 站內換頁攔截。沒有 data router 時只掛 beforeunload 的行為見 useUnsavedChangesGuard.test.js。
import { afterEach, describe, expect, test } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
    Link, MemoryRouter, Route, RouterProvider, Routes, createMemoryRouter, useNavigate,
} from 'react-router-dom';

import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';

const DIALOG_NAME = '尚未儲存的變更';

function Editor({ dirty }) {
    const { allowNextNavigation } = useUnsavedChangesGuard(dirty);
    const navigate = useNavigate();
    return (
        <div>
            <h1>編輯頁</h1>
            <Link to="/other">其他頁</Link>
            <Link to="/edit?tab=2">同頁換參數</Link>
            <button type="button" onClick={() => navigate('/other')}>程式導頁</button>
            {/* 模擬「新建提案存檔成功後換到提案專屬網址」 */}
            <button
                type="button"
                onClick={() => {
                    allowNextNavigation();
                    navigate('/revisions/7', { replace: true });
                }}
            >
                儲存
            </button>
            <button type="button" onClick={() => allowNextNavigation()}>只放行不導頁</button>
        </div>
    );
}

function renderEditor({ dirty = true } = {}) {
    const router = createMemoryRouter([
        { path: '/start', element: <p>起始頁內容</p> },
        { path: '/edit', element: <Editor dirty={dirty} /> },
        { path: '/other', element: <p>其他頁內容</p> },
        { path: '/revisions/:id', element: <p>提案頁內容</p> },
    ], { initialEntries: ['/start', '/edit'], initialIndex: 1 });
    render(<RouterProvider router={router} />);
    return router;
}

const findDialog = () => screen.findByRole('dialog', { name: DIALOG_NAME });

afterEach(async () => {
    // confirmAction 卸載自己的容器用了 setTimeout(0)；等它清乾淨，下一個測試才不會看到殘留的視窗
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

describe('useUnsavedChangesGuard：data router 底下攔截站內換頁', () => {
    test('有未儲存內容時點站內連結會先詢問；取消後留在原頁，之後再點仍會再問', async () => {
        const user = userEvent.setup();
        const router = renderEditor();

        await user.click(screen.getByRole('link', { name: '其他頁' }));
        await findDialog();
        expect(router.state.location.pathname).toBe('/edit');

        await user.click(screen.getByRole('button', { name: '繼續編輯' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(router.state.location.pathname).toBe('/edit');
        expect(screen.getByRole('heading', { name: '編輯頁' })).toBeInTheDocument();

        // reset 之後 blocker 回到待命狀態，下一次換頁照樣會被攔
        await user.click(screen.getByRole('link', { name: '其他頁' }));
        await findDialog();
        await user.click(screen.getByRole('button', { name: '繼續編輯' }));
        expect(router.state.location.pathname).toBe('/edit');
    });

    test('確認放棄後放行，換到目標頁', async () => {
        const user = userEvent.setup();
        const router = renderEditor();

        await user.click(screen.getByRole('link', { name: '其他頁' }));
        await findDialog();
        await user.click(screen.getByRole('button', { name: '放棄變更並離開' }));

        expect(await screen.findByText('其他頁內容')).toBeInTheDocument();
        expect(router.state.location.pathname).toBe('/other');
    });

    test('程式呼叫 navigate 一樣會被攔', async () => {
        const user = userEvent.setup();
        const router = renderEditor();

        await user.click(screen.getByRole('button', { name: '程式導頁' }));
        await findDialog();
        expect(router.state.location.pathname).toBe('/edit');
        await user.click(screen.getByRole('button', { name: '繼續編輯' }));
    });

    test('瀏覽器上一頁（POP）也會被攔；取消時網址留在原頁，確認後才真的回上一頁', async () => {
        const user = userEvent.setup();
        const router = renderEditor();

        act(() => { router.navigate(-1); });
        await findDialog();
        expect(router.state.location.pathname).toBe('/edit');
        await user.click(screen.getByRole('button', { name: '繼續編輯' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(router.state.location.pathname).toBe('/edit');

        act(() => { router.navigate(-1); });
        await findDialog();
        await user.click(screen.getByRole('button', { name: '放棄變更並離開' }));
        expect(await screen.findByText('起始頁內容')).toBeInTheDocument();
        expect(router.state.location.pathname).toBe('/start');
    });

    test('沒有未儲存內容時不攔', async () => {
        const user = userEvent.setup();
        const router = renderEditor({ dirty: false });

        await user.click(screen.getByRole('link', { name: '其他頁' }));
        expect(await screen.findByText('其他頁內容')).toBeInTheDocument();
        expect(router.state.location.pathname).toBe('/other');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('同一個路徑只改 search 參數不算離開，不攔（元件不會卸載，內容不會遺失）', async () => {
        const user = userEvent.setup();
        const router = renderEditor();

        await user.click(screen.getByRole('link', { name: '同頁換參數' }));
        await waitFor(() => expect(router.state.location.search).toBe('?tab=2'));
        expect(router.state.location.pathname).toBe('/edit');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('存檔成功後 allowNextNavigation() 再導頁，不會被自己的保護攔下', async () => {
        const user = userEvent.setup();
        const router = renderEditor();

        await user.click(screen.getByRole('button', { name: '儲存' }));
        expect(await screen.findByText('提案頁內容')).toBeInTheDocument();
        expect(router.state.location.pathname).toBe('/revisions/7');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('allowNextNavigation() 之後沒有導頁，放行不會一直留著', async () => {
        const user = userEvent.setup();
        const router = renderEditor();

        await user.click(screen.getByRole('button', { name: '只放行不導頁' }));
        // 放行只撐過同一輪事件；過一個 tick 之後使用者再點連結，照樣要詢問
        await act(() => new Promise((resolve) => { setTimeout(resolve, 10); }));
        await user.click(screen.getByRole('link', { name: '其他頁' }));
        await findDialog();
        expect(router.state.location.pathname).toBe('/edit');
        await user.click(screen.getByRole('button', { name: '繼續編輯' }));
    });

    test('data router 底下同樣掛 beforeunload', () => {
        renderEditor();
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });
});

describe('useUnsavedChangesGuard：正式入口的結構（data router 只有 path: * 一條，真正的路由在巢狀 <Routes>）', () => {
    test('巢狀 <Routes> 裡的編輯頁一樣攔得住站內連結，確認後放行', async () => {
        const user = userEvent.setup();
        const router = createMemoryRouter([{
            path: '*',
            element: (
                <Routes>
                    <Route path="/admin/*" element={(
                        <Routes>
                            <Route path="edit" element={<Editor dirty />} />
                        </Routes>
                    )} />
                    <Route path="/other" element={<p>其他頁內容</p>} />
                </Routes>
            ),
        }], { initialEntries: ['/admin/edit'] });
        render(<RouterProvider router={router} />);

        await user.click(screen.getByRole('link', { name: '其他頁' }));
        await findDialog();
        expect(router.state.location.pathname).toBe('/admin/edit');
        await user.click(screen.getByRole('button', { name: '放棄變更並離開' }));
        expect(await screen.findByText('其他頁內容')).toBeInTheDocument();
    });
});

describe('useUnsavedChangesGuard：非 data router（多數既有元件測試用的 MemoryRouter）', () => {
    test('不會因為 useBlocker 丟錯，站內連結照常換頁，只保留 beforeunload', async () => {
        const user = userEvent.setup();
        render(
            <MemoryRouter initialEntries={['/edit']}>
                <Routes>
                    <Route path="/edit" element={<Editor dirty />} />
                    <Route path="/other" element={<p>其他頁內容</p>} />
                </Routes>
            </MemoryRouter>,
        );
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);

        await user.click(screen.getByRole('link', { name: '其他頁' }));
        expect(await screen.findByText('其他頁內容')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
