import {
    beforeEach, describe, expect, test, vi,
} from 'vitest';
import {
    fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SharedNotesModeration from './SharedNotesModeration';
import RecordingsModeration from './RecordingsModeration';
import ReportsQueue from './ReportsQueue';
import { stripHtml } from './notePreviewText';
import { apiGet, apiPost } from '../../../utils/apiClient';

vi.mock('@components/ui/ConfirmDialog', () => ({ confirmAction: vi.fn() }));

vi.mock('../../../utils/apiClient', () => ({
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    apiDelete: vi.fn(),
}));

vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({ userData: { role: 'owner' }, loading: false }),
}));

const emptyPage = { results: [], count: 0, page: 1, page_size: 20 };

describe('stripHtml（稽核 FE7b-22）', () => {
    test('解碼 HTML 實體並壓縮連續空白', () => {
        expect(stripHtml('<p>A &amp; B&nbsp;&nbsp;C</p>')).toBe('A & B C');
        expect(stripHtml('<span style="x">你好</span>  <b>世界</b>')).toBe('你好 世界');
        expect(stripHtml(null)).toBe('');
    });
});

describe('審核頁讀網址參數當初始篩選（稽核 FE7b-07）', () => {
    beforeEach(() => {
        apiGet.mockReset();
        apiGet.mockResolvedValue(emptyPage);
    });

    test('分享筆記頁把 ?id= 帶進查詢', async () => {
        render(
            <MemoryRouter initialEntries={['/admin/moderation/notes?id=note9']}>
                <SharedNotesModeration />
            </MemoryRouter>,
        );

        await waitFor(() => expect(apiGet).toHaveBeenCalled());
        const [url] = apiGet.mock.calls[0];
        expect(new URLSearchParams(url.split('?')[1]).get('id')).toBe('note9');
        expect(screen.getByText(/目前只顯示筆記 ID：note9/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '顯示全部' }));
        await waitFor(() => {
            const [last] = apiGet.mock.calls.at(-1);
            expect(new URLSearchParams(last.split('?')[1]).has('id')).toBe(false);
        });
    });

    test('錄音頁把 ?id= 與 ?tribe= 帶進查詢', async () => {
        render(
            <MemoryRouter initialEntries={['/admin/moderation/recordings?id=rec1&tribe=tayal']}>
                <RecordingsModeration />
            </MemoryRouter>,
        );

        await waitFor(() => expect(apiGet).toHaveBeenCalled());
        const params = new URLSearchParams(apiGet.mock.calls[0][0].split('?')[1]);
        expect(params.get('id')).toBe('rec1');
        expect(params.get('tribe')).toBe('tayal');
    });

    test('錄音播放器有可及名稱（稽核 FE7b-20）', async () => {
        apiGet.mockResolvedValue({
            ...emptyPage,
            results: [{
                id: 'rec1', tribe: 'tayal', word: 'abas', score: 80, approved: false, report_count: 0, storage_url: 'https://x/a.mp3',
            }],
            count: 1,
        });
        const { container } = render(
            <MemoryRouter><RecordingsModeration /></MemoryRouter>,
        );

        await screen.findByText('abas');
        expect(container.querySelector('audio')).toHaveAttribute('aria-label', 'abas 的發音錄音');
    });
});

describe('ReportsQueue 核結失敗（稽核 FE7b-01）', () => {
    test('錯誤顯示在對話框內', async () => {
        apiGet.mockReset();
        apiPost.mockReset();
        apiGet.mockResolvedValue({
            results: [{
                id: 'r1', target_type: 'note', target_id: 'n1', status: 'pending', reason: 'spam', reporter_uid: 'u',
                target_summary: { preview: 'hi', username: 'x' },
            }],
            count: 1,
            page: 1,
            page_size: 20,
        });
        apiPost.mockRejectedValue(new Error('已被他人處理'));

        render(<MemoryRouter><ReportsQueue /></MemoryRouter>);

        fireEvent.click(await screen.findByRole('button', { name: /核結/ }));
        fireEvent.click(await screen.findByRole('button', { name: '確認核結' }));

        const dialog = await screen.findByRole('dialog');
        await waitFor(() => {
            expect(dialog.querySelector('[role="alert"]')).toHaveTextContent('已被他人處理');
        });
    });
});
