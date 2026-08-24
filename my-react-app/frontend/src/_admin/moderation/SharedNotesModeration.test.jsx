import {
    beforeEach,
    describe,
    expect,
    test,
    vi,
} from 'vitest';
import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SharedNotesModeration from './SharedNotesModeration';
import { apiGet, apiPost } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
    apiGet: vi.fn(),
    apiPost: vi.fn(),
}));

let mockRole = 'owner';

vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({
        userData: { role: mockRole },
        loading: false,
    }),
}));

const normalNote = {
    id: 'note123',
    preview: '這是一段正常的分享筆記內容',
    image: 'https://example.com/note.jpg',
    uid: 'author-uid',
    username: '筆記作者',
    likes: 12,
    deleted: false,
    created_at: { seconds: 123456 },
    report_count: 2,
};

const deletedNote = {
    id: 'note456',
    preview: '已經下架的分享筆記',
    image: '',
    uid: 'another-author',
    username: '另一位作者',
    likes: 3,
    deleted: true,
    created_at: { _seconds: 654321 },
    report_count: 0,
};

function mockNotesResponse(overrides = {}) {
    return {
        results: [normalNote, deletedNote],
        count: 2,
        page: 1,
        page_size: 20,
        ...overrides,
    };
}

function renderPage() {
    return render(
        <MemoryRouter>
            <SharedNotesModeration />
        </MemoryRouter>,
    );
}

describe('SharedNotesModeration', () => {
    beforeEach(() => {
        mockRole = 'owner';
        apiGet.mockReset();
        apiPost.mockReset();
        apiGet.mockResolvedValue(mockNotesResponse());
        apiPost.mockResolvedValue({
            id: 'note123',
            deleted: true,
        });
        vi.spyOn(window, 'confirm').mockReturnValue(true);
    });

    test('載入後顯示分享筆記、作者、檢舉數與狀態', async () => {
        renderPage();

        expect(
            await screen.findByText('這是一段正常的分享筆記內容'),
        ).toBeInTheDocument();
        expect(screen.getByText('筆記作者')).toBeInTheDocument();

        const normalRow = screen
            .getByText('這是一段正常的分享筆記內容')
            .closest('tr');

        expect(within(normalRow).getByText('2')).toHaveClass('badge');
        expect(within(normalRow).getByText('正常')).toBeInTheDocument();

        const deletedRow = screen
            .getByText('已經下架的分享筆記')
            .closest('tr');

        expect(within(deletedRow).getByText('已下架')).toBeInTheDocument();
    });

    test('有圖片的筆記顯示縮圖，沒有圖片時不建立 img', async () => {
        renderPage();

        const normalRow = await screen
            .findByText('這是一段正常的分享筆記內容')
            .then((element) => element.closest('tr'));

        // 縮圖用 alt="" 標成裝飾性圖片（不重複朗讀 preview 已有的文字），
        // 這會讓瀏覽器把它的 accessible role 變成 presentation 而非 img，
        // getByRole('img') 找不到，所以改用 CSS selector 直接查 <img>。
        expect(normalRow.querySelector('img')).toHaveAttribute(
            'src',
            'https://example.com/note.jpg',
        );

        const deletedRow = screen
            .getByText('已經下架的分享筆記')
            .closest('tr');

        expect(deletedRow.querySelector('img')).not.toBeInTheDocument();
    });

    test('送出篩選後帶入 keyword、deleted 與 has_reports 參數', async () => {
        renderPage();
        await screen.findByText('這是一段正常的分享筆記內容');

        fireEvent.change(screen.getByLabelText('關鍵字'), {
            target: { value: '作者名稱' },
        });
        fireEvent.change(screen.getByLabelText('狀態'), {
            target: { value: 'false' },
        });
        fireEvent.click(screen.getByLabelText('只看有檢舉的'));
        fireEvent.click(screen.getByRole('button', { name: '搜尋' }));

        await waitFor(() => {
            const [url] = apiGet.mock.calls.at(-1);

            expect(url).toContain('keyword=%E4%BD%9C%E8%80%85%E5%90%8D%E7%A8%B1');
            expect(url).toContain('deleted=false');
            expect(url).toContain('has_reports=true');
            expect(url).toContain('page=1');
            expect(url).toContain('page_size=20');
        });
    });

    test('owner 下架筆記前顯示確認框並呼叫 toggle-deleted 端點', async () => {
        renderPage();

        const row = await screen
            .findByText('這是一段正常的分享筆記內容')
            .then((element) => element.closest('tr'));

        fireEvent.click(
            within(row).getByRole('button', { name: /下架/ }),
        );

        expect(window.confirm).toHaveBeenCalledWith(
            expect.stringContaining('確定要下架'),
        );

        await waitFor(() => {
            // 帶上「我看到的狀態」讓後端比對，避免清單過期時操作方向相反
            expect(apiPost).toHaveBeenCalledWith(
                '/adminapi/moderation/notes/note123/toggle-deleted/',
                { expected_deleted: false },
            );
        });

        expect(await screen.findByText('分享筆記已下架')).toBeInTheDocument();
        expect(apiGet.mock.calls.length).toBeGreaterThan(1);
    });

    test('owner 可以恢復已下架的筆記', async () => {
        apiPost.mockResolvedValue({
            id: 'note456',
            deleted: false,
        });

        renderPage();

        const row = await screen
            .findByText('已經下架的分享筆記')
            .then((element) => element.closest('tr'));

        fireEvent.click(
            within(row).getByRole('button', { name: /恢復/ }),
        );

        expect(window.confirm).toHaveBeenCalledWith(
            expect.stringContaining('確定要恢復'),
        );

        await waitFor(() => {
            expect(apiPost).toHaveBeenCalledWith(
                '/adminapi/moderation/notes/note456/toggle-deleted/',
                { expected_deleted: true },
            );
        });

        expect(await screen.findByText('分享筆記已恢復')).toBeInTheDocument();
    });

    test('取消原生確認框時不呼叫下架 API', async () => {
        window.confirm.mockReturnValue(false);
        renderPage();

        const row = await screen
            .findByText('這是一段正常的分享筆記內容')
            .then((element) => element.closest('tr'));

        fireEvent.click(
            within(row).getByRole('button', { name: /下架/ }),
        );

        expect(window.confirm).toHaveBeenCalled();
        expect(apiPost).not.toHaveBeenCalled();
    });

    test('reviewer 可以讀取列表，但看不到上下架操作', async () => {
        mockRole = 'reviewer';
        renderPage();

        const row = await screen
            .findByText('這是一段正常的分享筆記內容')
            .then((element) => element.closest('tr'));

        expect(within(row).getByText('僅供檢視')).toBeInTheDocument();
        expect(
            within(row).queryByRole('button', { name: /下架|恢復/ }),
        ).not.toBeInTheDocument();
        expect(apiGet).toHaveBeenCalled();
    });

    test('非 STAFF_ROLES 使用者看到權限錯誤且不呼叫 API', () => {
        mockRole = 'student';
        renderPage();

        expect(
            screen.getByText('你沒有檢視分享筆記審核頁面的權限。'),
        ).toBeInTheDocument();
        expect(apiGet).not.toHaveBeenCalled();
    });

    test('下一頁按鈕依分頁資料啟用，點擊後查詢第二頁', async () => {
        apiGet.mockResolvedValue(
            mockNotesResponse({
                count: 25,
                page: 1,
                page_size: 20,
            }),
        );

        renderPage();
        await screen.findByText('這是一段正常的分享筆記內容');

        const nextButton = screen.getByRole('button', { name: '下一頁' });
        expect(nextButton).not.toBeDisabled();

        fireEvent.click(nextButton);

        await waitFor(() => {
            const [url] = apiGet.mock.calls.at(-1);
            expect(url).toContain('page=2');
        });
    });

    test('第一頁的上一頁按鈕停用', async () => {
        renderPage();
        await screen.findByText('這是一段正常的分享筆記內容');

        expect(
            screen.getByRole('button', { name: '上一頁' }),
        ).toBeDisabled();
    });

    test('apiGet 失敗時顯示錯誤訊息', async () => {
        apiGet.mockRejectedValueOnce(new Error('分享筆記載入失敗'));

        renderPage();

        expect(
            await screen.findByText('分享筆記載入失敗'),
        ).toBeInTheDocument();
    });

    test('toggle API 失敗時顯示錯誤訊息', async () => {
        apiPost.mockRejectedValueOnce(new Error('無法變更筆記狀態'));

        renderPage();

        const row = await screen
            .findByText('這是一段正常的分享筆記內容')
            .then((element) => element.closest('tr'));

        fireEvent.click(
            within(row).getByRole('button', { name: /下架/ }),
        );

        expect(
            await screen.findByText('無法變更筆記狀態'),
        ).toBeInTheDocument();
    });

    test('某一列處理中時，其他列的上下架按鈕會被停用', async () => {
        let resolveToggle;
        apiPost.mockImplementation(() => new Promise((resolve) => { resolveToggle = resolve; }));

        renderPage();

        const normalRow = await screen
            .findByText('這是一段正常的分享筆記內容')
            .then((element) => element.closest('tr'));
        const deletedRow = screen
            .getByText('已經下架的分享筆記')
            .closest('tr');

        fireEvent.click(
            within(normalRow).getByRole('button', { name: /下架/ }),
        );

        await waitFor(() => {
            expect(
                within(deletedRow).getByRole('button', { name: /恢復/ }),
            ).toBeDisabled();
        });

        resolveToggle({ id: 'note123', deleted: true });

        await waitFor(() => {
            expect(
                within(deletedRow).getByRole('button', { name: /恢復/ }),
            ).not.toBeDisabled();
        });
    });
});
