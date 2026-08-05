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
import RecordingsModeration from './RecordingsModeration';
import { apiDelete, apiGet } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
    apiGet: vi.fn(),
    apiDelete: vi.fn(),
}));

let mockRole = 'owner';

vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({
        userData: { role: mockRole },
        loading: false,
    }),
}));

const recording = {
    id: 'rec123',
    tribe: 'tayal',
    word: 'abas',
    uid: 'uploader-uid',
    score: 85,
    storage_url: 'https://example.com/audio/abas.mp3',
    created_at: { seconds: 123456 },
    report_count: 3,
};

const cleanRecording = {
    id: 'rec456',
    tribe: 'amis',
    word: 'loma',
    uid: 'second-uploader',
    score: 92,
    storage_url: 'https://example.com/audio/loma.mp3',
    created_at: { _seconds: 654321 },
    report_count: 0,
};

function mockRecordingsResponse(overrides = {}) {
    return {
        results: [recording, cleanRecording],
        count: 2,
        page: 1,
        page_size: 20,
        ...overrides,
    };
}

function renderPage() {
    return render(
        <MemoryRouter>
            <RecordingsModeration />
        </MemoryRouter>,
    );
}

describe('RecordingsModeration', () => {
    beforeEach(() => {
        mockRole = 'owner';
        apiGet.mockReset();
        apiDelete.mockReset();
        apiGet.mockResolvedValue(mockRecordingsResponse());
        apiDelete.mockResolvedValue({
            tribe: 'tayal',
            id: 'rec123',
            deleted: true,
            storage_deleted: true,
        });
        vi.spyOn(window, 'confirm').mockReturnValue(true);
    });

    test('載入後顯示詞彙、族語、分數與檢舉數', async () => {
        renderPage();

        expect(await screen.findByText('abas')).toBeInTheDocument();

        const row = screen.getByText('abas').closest('tr');

        expect(within(row).getByText('泰雅')).toBeInTheDocument();
        expect(within(row).getByText('85')).toBeInTheDocument();
        expect(within(row).getByText('3')).toHaveClass('badge');
        expect(within(row).getByText('uploader-uid')).toBeInTheDocument();

        const amisRow = screen.getByText('loma').closest('tr');
        expect(within(amisRow).getByText('阿美')).toBeInTheDocument();
    });

    test('每列使用 audio controls 播放 storage_url', async () => {
        renderPage();

        const row = await screen
            .findByText('abas')
            .then((element) => element.closest('tr'));
        const audio = row.querySelector('audio');

        expect(audio).toBeInTheDocument();
        expect(audio).toHaveAttribute(
            'src',
            'https://example.com/audio/abas.mp3',
        );
        expect(audio).toHaveAttribute('controls');
    });

    test('族語和檢舉篩選送出後帶入查詢參數', async () => {
        renderPage();
        await screen.findByText('abas');

        fireEvent.change(screen.getByLabelText('族語'), {
            target: { value: 'bunun' },
        });
        fireEvent.click(screen.getByLabelText('只看有檢舉的'));
        fireEvent.click(screen.getByRole('button', { name: '搜尋' }));

        await waitFor(() => {
            const [url] = apiGet.mock.calls.at(-1);

            expect(url).toContain('tribe=bunun');
            expect(url).toContain('has_reports=true');
            expect(url).toContain('page=1');
            expect(url).toContain('page_size=20');
        });
    });

    test('owner 刪除前顯示無法復原確認訊息並呼叫正確路徑', async () => {
        renderPage();

        const row = await screen
            .findByText('abas')
            .then((element) => element.closest('tr'));

        fireEvent.click(
            within(row).getByRole('button', { name: /刪除/ }),
        );

        expect(window.confirm).toHaveBeenCalledWith(
            expect.stringMatching(/永久刪除.*此操作無法復原/),
        );

        await waitFor(() => {
            expect(apiDelete).toHaveBeenCalledWith(
                '/adminapi/moderation/recordings/tayal/rec123/',
            );
        });

        expect(await screen.findByText('發音錄音已刪除')).toBeInTheDocument();
        expect(apiGet.mock.calls.length).toBeGreaterThan(1);
    });

    test('storage_deleted=false 時提示需要人工複查', async () => {
        apiDelete.mockResolvedValueOnce({
            tribe: 'tayal',
            id: 'rec123',
            deleted: true,
            storage_deleted: false,
        });

        renderPage();

        const row = await screen
            .findByText('abas')
            .then((element) => element.closest('tr'));

        fireEvent.click(
            within(row).getByRole('button', { name: /刪除/ }),
        );

        expect(
            await screen.findByText(
                '已刪除（音檔清除失敗，需人工複查）',
            ),
        ).toBeInTheDocument();
    });

    test('取消確認時不呼叫刪除 API', async () => {
        window.confirm.mockReturnValue(false);
        renderPage();

        const row = await screen
            .findByText('abas')
            .then((element) => element.closest('tr'));

        fireEvent.click(
            within(row).getByRole('button', { name: /刪除/ }),
        );

        expect(window.confirm).toHaveBeenCalled();
        expect(apiDelete).not.toHaveBeenCalled();
    });

    test('analyst 可以檢視錄音但看不到刪除按鈕', async () => {
        mockRole = 'analyst';
        renderPage();

        const row = await screen
            .findByText('abas')
            .then((element) => element.closest('tr'));

        expect(within(row).getByText('僅供檢視')).toBeInTheDocument();
        expect(
            within(row).queryByRole('button', { name: /刪除/ }),
        ).not.toBeInTheDocument();
        expect(apiGet).toHaveBeenCalled();
    });

    test('非 STAFF_ROLES 使用者看到權限錯誤且不呼叫 API', () => {
        mockRole = 'student';
        renderPage();

        expect(
            screen.getByText('你沒有檢視發音錄音審核頁面的權限。'),
        ).toBeInTheDocument();
        expect(apiGet).not.toHaveBeenCalled();
    });

    test('有下一頁時按鈕啟用並查詢第二頁', async () => {
        apiGet.mockResolvedValue(
            mockRecordingsResponse({
                count: 41,
                page: 1,
                page_size: 20,
            }),
        );

        renderPage();
        await screen.findByText('abas');

        const nextButton = screen.getByRole('button', { name: '下一頁' });
        expect(nextButton).not.toBeDisabled();

        fireEvent.click(nextButton);

        await waitFor(() => {
            const [url] = apiGet.mock.calls.at(-1);
            expect(url).toContain('page=2');
        });
    });

    test('最後一頁停用下一頁按鈕', async () => {
        apiGet.mockResolvedValue(
            mockRecordingsResponse({
                count: 22,
                page: 2,
                page_size: 20,
            }),
        );

        renderPage();
        await screen.findByText('abas');

        expect(
            screen.getByRole('button', { name: '下一頁' }),
        ).toBeDisabled();
    });

    test('列表載入失敗時顯示錯誤訊息', async () => {
        apiGet.mockRejectedValueOnce(new Error('錄音列表載入失敗'));

        renderPage();

        expect(
            await screen.findByText('錄音列表載入失敗'),
        ).toBeInTheDocument();
    });

    test('刪除失敗時顯示錯誤訊息', async () => {
        apiDelete.mockRejectedValueOnce(new Error('錄音刪除失敗'));

        renderPage();

        const row = await screen
            .findByText('abas')
            .then((element) => element.closest('tr'));

        fireEvent.click(
            within(row).getByRole('button', { name: /刪除/ }),
        );

        expect(
            await screen.findByText('錄音刪除失敗'),
        ).toBeInTheDocument();
    });
});
