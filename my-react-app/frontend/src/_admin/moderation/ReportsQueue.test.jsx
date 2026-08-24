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
import ReportsQueue from './ReportsQueue';
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

const noteReport = {
    id: 'rep123',
    target_type: 'note',
    target_id: 'note123',
    target_tribe: '',
    reporter_uid: 'reporter-u1',
    reason: 'inappropriate',
    reason_text: '內容包含不適當字詞',
    status: 'pending',
    created_at: { seconds: 123456 },
    resolved_by: null,
    resolved_at: null,
    resolution_note: '',
    target_summary: {
        preview: '被檢舉的分享筆記內容',
        username: '筆記作者',
    },
};

const recordingReport = {
    id: 'rep456',
    target_type: 'recording',
    target_id: 'rec456',
    target_tribe: 'tayal',
    reporter_uid: 'reporter-u2',
    reason: 'wrong_content',
    reason_text: '',
    status: 'resolved',
    created_at: { _seconds: 654321 },
    resolved_by: 'admin-uid',
    resolved_at: { seconds: 654399 },
    resolution_note: '已確認錄音內容有誤',
    target_summary: {
        word: 'abas',
        tribe: 'tayal',
        score: 85,
    },
};

const missingTargetReport = {
    id: 'rep789',
    target_type: 'note',
    target_id: 'deleted-note',
    target_tribe: '',
    reporter_uid: 'reporter-u3',
    reason: 'spam',
    reason_text: '',
    status: 'dismissed',
    created_at: { seconds: 777777 },
    resolved_by: 'owner-uid',
    resolved_at: { seconds: 777799 },
    resolution_note: '',
    target_summary: null,
};

function mockReportsResponse(overrides = {}) {
    return {
        results: [
            noteReport,
            recordingReport,
            missingTargetReport,
        ],
        count: 3,
        page: 1,
        page_size: 20,
        ...overrides,
    };
}

function renderPage() {
    return render(
        <MemoryRouter>
            <ReportsQueue />
        </MemoryRouter>,
    );
}

describe('ReportsQueue', () => {
    beforeEach(() => {
        mockRole = 'owner';
        apiGet.mockReset();
        apiPost.mockReset();
        apiGet.mockResolvedValue(mockReportsResponse());
        apiPost.mockResolvedValue({
            id: 'rep123',
            status: 'resolved',
        });
    });

    test('預設以 pending 狀態查詢檢舉佇列', async () => {
        renderPage();

        await screen.findByText('被檢舉的分享筆記內容');

        expect(screen.getByLabelText('狀態')).toHaveValue('pending');

        const [url] = apiGet.mock.calls[0];
        expect(url).toContain('status=pending');
        expect(url).toContain('page=1');
        expect(url).toContain('page_size=20');
    });

    test('顯示筆記摘要、原因中文、補充說明與檢舉人', async () => {
        renderPage();

        const summary = await screen.findByText('被檢舉的分享筆記內容');
        const row = summary.closest('tr');

        expect(within(row).getByText('分享筆記')).toBeInTheDocument();
        expect(within(row).getByText('作者：筆記作者')).toBeInTheDocument();
        expect(within(row).getByText('不當內容')).toBeInTheDocument();
        expect(
            within(row).getByText('內容包含不適當字詞'),
        ).toBeInTheDocument();
        expect(within(row).getByText('reporter-u1')).toBeInTheDocument();
        expect(within(row).getByText('待處理')).toBeInTheDocument();
    });

    test('錄音摘要顯示詞彙、族語與分數', async () => {
        renderPage();

        const word = await screen.findByText('abas');
        const row = word.closest('tr');

        expect(within(row).getByText('發音錄音')).toBeInTheDocument();
        expect(
            within(row).getByText('族語：泰雅 · 分數：85'),
        ).toBeInTheDocument();
        expect(within(row).getByText('內容錯誤')).toBeInTheDocument();
        expect(within(row).getByText('已核結')).toBeInTheDocument();
        expect(
            within(row).getByText('備註：已確認錄音內容有誤'),
        ).toBeInTheDocument();
    });

    test('原始內容已刪除時顯示內容已不存在', async () => {
        renderPage();

        expect(
            await screen.findByText('內容已不存在'),
        ).toBeInTheDocument();
    });

    test('狀態和內容類型篩選送出後使用對應參數', async () => {
        renderPage();
        await screen.findByText('被檢舉的分享筆記內容');

        fireEvent.change(screen.getByLabelText('狀態'), {
            target: { value: 'dismissed' },
        });
        fireEvent.change(screen.getByLabelText('內容類型'), {
            target: { value: 'recording' },
        });
        fireEvent.click(screen.getByRole('button', { name: '搜尋' }));

        await waitFor(() => {
            const [url] = apiGet.mock.calls.at(-1);

            expect(url).toContain('status=dismissed');
            expect(url).toContain('target_type=recording');
            expect(url).toContain('page=1');
        });
    });

    test('選擇全部狀態時不傳 status 參數', async () => {
        renderPage();
        await screen.findByText('被檢舉的分享筆記內容');

        fireEvent.change(screen.getByLabelText('狀態'), {
            target: { value: '' },
        });
        fireEvent.click(screen.getByRole('button', { name: '搜尋' }));

        await waitFor(() => {
            const [url] = apiGet.mock.calls.at(-1);
            const queryString = url.split('?')[1];
            const params = new URLSearchParams(queryString);

            expect(params.has('status')).toBe(false);
        });
    });

    test('pending 筆記提供前往分享筆記頁面的快速連結', async () => {
        renderPage();

        const row = await screen
            .findByText('被檢舉的分享筆記內容')
            .then((element) => element.closest('tr'));
        const link = within(row).getByRole('button', {
            name: /查看內容/,
        });

        expect(link).toHaveAttribute(
            'href',
            '/admin/moderation/notes',
        );
    });

    test('錄音檢舉連結前往錄音列表且不附加 target ID', async () => {
        renderPage();

        const row = await screen
            .findByText('abas')
            .then((element) => element.closest('tr'));
        const link = within(row).getByRole('button', {
            name: /查看內容/,
        });

        expect(link).toHaveAttribute(
            'href',
            '/admin/moderation/recordings',
        );
        expect(link.getAttribute('href')).not.toContain('rec456');
    });

    test('owner 點核結後可填選填備註並送到 resolve 端點', async () => {
        renderPage();

        const row = await screen
            .findByText('被檢舉的分享筆記內容')
            .then((element) => element.closest('tr'));

        fireEvent.click(
            within(row).getByRole('button', { name: /^核結$/ }),
        );

        const modal = await screen.findByRole('dialog');

        expect(
            within(modal).getByText('核結檢舉'),
        ).toBeInTheDocument();

        fireEvent.change(
            within(modal).getByLabelText('處理備註（選填）'),
            { target: { value: ' 已通知內容管理員處理 ' } },
        );
        fireEvent.click(
            within(modal).getByRole('button', { name: '確認核結' }),
        );

        await waitFor(() => {
            expect(apiPost).toHaveBeenCalledWith(
                '/adminapi/reports/rep123/resolve/',
                { resolution_note: '已通知內容管理員處理' },
            );
        });

        expect(await screen.findByText('檢舉已核結')).toBeInTheDocument();
        expect(apiGet.mock.calls.length).toBeGreaterThan(1);
    });

    test('處理備註為選填，留空仍可核結', async () => {
        renderPage();

        const row = await screen
            .findByText('被檢舉的分享筆記內容')
            .then((element) => element.closest('tr'));

        fireEvent.click(
            within(row).getByRole('button', { name: /^核結$/ }),
        );
        fireEvent.click(
            await screen.findByRole('button', { name: '確認核結' }),
        );

        await waitFor(() => {
            expect(apiPost).toHaveBeenCalledWith(
                '/adminapi/reports/rep123/resolve/',
                { resolution_note: '' },
            );
        });
    });

    test('點駁回後呼叫 dismiss 端點', async () => {
        apiPost.mockResolvedValueOnce({
            id: 'rep123',
            status: 'dismissed',
        });

        renderPage();

        const row = await screen
            .findByText('被檢舉的分享筆記內容')
            .then((element) => element.closest('tr'));

        fireEvent.click(
            within(row).getByRole('button', { name: /^駁回$/ }),
        );

        const modal = await screen.findByRole('dialog');

        fireEvent.change(
            within(modal).getByLabelText('處理備註（選填）'),
            { target: { value: '未發現違規內容' } },
        );
        fireEvent.click(
            within(modal).getByRole('button', { name: '確認駁回' }),
        );

        await waitFor(() => {
            expect(apiPost).toHaveBeenCalledWith(
                '/adminapi/reports/rep123/dismiss/',
                { resolution_note: '未發現違規內容' },
            );
        });

        expect(await screen.findByText('檢舉已駁回')).toBeInTheDocument();
    });

    test('非 pending 狀態不顯示核結與駁回操作', async () => {
        renderPage();

        const row = await screen
            .findByText('abas')
            .then((element) => element.closest('tr'));

        expect(
            within(row).queryByRole('button', { name: /^核結$/ }),
        ).not.toBeInTheDocument();
        expect(
            within(row).queryByRole('button', { name: /^駁回$/ }),
        ).not.toBeInTheDocument();
        expect(
            within(row).getByRole('button', { name: /查看內容/ }),
        ).toBeInTheDocument();
    });

    test('reviewer 可檢視 pending 檢舉但看不到處理按鈕', async () => {
        mockRole = 'reviewer';
        renderPage();

        const row = await screen
            .findByText('被檢舉的分享筆記內容')
            .then((element) => element.closest('tr'));

        expect(
            within(row).queryByRole('button', { name: /^核結$/ }),
        ).not.toBeInTheDocument();
        expect(
            within(row).queryByRole('button', { name: /^駁回$/ }),
        ).not.toBeInTheDocument();
        expect(apiGet).toHaveBeenCalled();
    });

    test('非 STAFF_ROLES 使用者看到權限錯誤且不呼叫 API', () => {
        mockRole = 'student';
        renderPage();

        expect(
            screen.getByText('你沒有檢視檢舉佇列的權限。'),
        ).toBeInTheDocument();
        expect(apiGet).not.toHaveBeenCalled();
    });

    test('分頁下一頁按鈕查詢第二頁', async () => {
        apiGet.mockResolvedValue(
            mockReportsResponse({
                count: 24,
                page: 1,
                page_size: 20,
            }),
        );

        renderPage();
        await screen.findByText('被檢舉的分享筆記內容');

        const nextButton = screen.getByRole('button', { name: '下一頁' });
        expect(nextButton).not.toBeDisabled();

        fireEvent.click(nextButton);

        await waitFor(() => {
            const [url] = apiGet.mock.calls.at(-1);
            expect(url).toContain('page=2');
        });
    });

    test('列表載入失敗時顯示錯誤訊息', async () => {
        apiGet.mockRejectedValueOnce(new Error('檢舉佇列載入失敗'));

        renderPage();

        expect(
            await screen.findByText('檢舉佇列載入失敗'),
        ).toBeInTheDocument();
    });

    test('核結失敗時保留 Modal 並顯示錯誤訊息', async () => {
        apiPost.mockRejectedValueOnce(new Error('檢舉核結失敗'));

        renderPage();

        const row = await screen
            .findByText('被檢舉的分享筆記內容')
            .then((element) => element.closest('tr'));

        fireEvent.click(
            within(row).getByRole('button', { name: /^核結$/ }),
        );
        fireEvent.click(
            await screen.findByRole('button', { name: '確認核結' }),
        );

        expect(
            await screen.findByText('檢舉核結失敗'),
        ).toBeInTheDocument();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    test('未知的 target_type 顯示安全的通用摘要，不套用其他類型的欄位或連結', async () => {
        const unknownTypeReport = {
            id: 'rep999',
            target_type: 'comment',
            target_id: 'comment123',
            reporter_uid: 'reporter-u4',
            reason: 'other',
            reason_text: '',
            status: 'pending',
            created_at: { seconds: 888888 },
            resolved_by: null,
            resolved_at: null,
            resolution_note: '',
            target_summary: { word: '不應該被當成錄音顯示' },
        };

        apiGet.mockResolvedValue(mockReportsResponse({
            results: [unknownTypeReport],
            count: 1,
        }));

        renderPage();

        const row = await screen
            .findByText('未知的內容類型')
            .then((element) => element.closest('tr'));

        expect(within(row).queryByText(/不應該被當成錄音顯示/)).not.toBeInTheDocument();
        expect(
            within(row).queryByRole('button', { name: /查看內容/ }),
        ).not.toBeInTheDocument();
    });
});
