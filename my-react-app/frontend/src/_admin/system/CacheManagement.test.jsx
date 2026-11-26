import {
    beforeEach, describe, expect, test, vi,
} from 'vitest';
import {
    fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import CacheManagement from './CacheManagement';
import { apiGet, apiPost } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
    apiGet: vi.fn(),
    apiPost: vi.fn(),
}));

// 清除快取前會先跳確認（稽核 FE7a-10）：測試直接替換成可控制回傳值的 mock
const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock('@components/ui/ConfirmDialog', () => ({ confirmAction: confirmMock }));

let mockRole = 'owner';
vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

const baseCaches = [
    {
        key: 'crawler_exam_site_html',
        description: '考試時程原始 HTML（15 分鐘）',
    },
    {
        key: 'crawler_news_data',
        description: '首頁消息（15 分鐘）',
    },
    {
        key: 'crawler_exam_schedule_data',
        description: '考試時程解析結果（15 分鐘）',
    },
];

describe('CacheManagement', () => {
    beforeEach(() => {
        mockRole = 'owner';
        apiGet.mockReset();
        apiPost.mockReset();
        confirmMock.mockReset().mockResolvedValue(true);
        apiGet.mockResolvedValue({ django_caches: baseCaches });
    });

    test('清除前先確認，使用者取消就不送出任何請求（稽核 FE7a-10）', async () => {
        confirmMock.mockResolvedValue(false);
        render(<CacheManagement />);
        await screen.findByText('crawler_exam_site_html');

        fireEvent.click(screen.getByRole('button', { name: /清除全部 Django 快取/ }));
        await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
        expect(confirmMock.mock.calls[0][0].message).toMatch(/立即失效/);
        fireEvent.click(screen.getByRole('button', { name: /清除全部 FastAPI 快取/ }));
        await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(2));

        expect(apiPost).not.toHaveBeenCalled();
    });

    test('兩顆清除按鈕互斥：確認視窗開著時，另一顆不會同時觸發', async () => {
        confirmMock.mockReturnValue(new Promise(() => {}));
        render(<CacheManagement />);
        await screen.findByText('crawler_exam_site_html');

        fireEvent.click(screen.getByRole('button', { name: /清除全部 Django 快取/ }));
        expect(screen.getByRole('button', { name: /清除全部 FastAPI 快取/ })).toBeDisabled();
        expect(confirmMock).toHaveBeenCalledTimes(1);
    });

    // WP-8 追加：確認視窗開著時還沒真的清除，按鈕不該顯示轉圈圈；確認後才顯示
    test('確認視窗開著時按鈕不顯示清除中的轉圈圈，確認後才顯示', async () => {
        let resolveConfirm;
        confirmMock.mockReturnValue(new Promise((resolve) => { resolveConfirm = resolve; }));
        let resolvePost;
        apiPost.mockReturnValue(new Promise((resolve) => { resolvePost = resolve; }));
        render(<CacheManagement />);
        await screen.findByText('crawler_exam_site_html');

        const djangoButton = screen.getByRole('button', { name: /清除全部 Django 快取/ });
        fireEvent.click(djangoButton);
        await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
        expect(djangoButton).toBeDisabled();
        expect(djangoButton.querySelector('.spinner-border')).toBeNull();

        resolveConfirm(true);
        await waitFor(() => expect(djangoButton.querySelector('.spinner-border')).not.toBeNull());

        resolvePost({ cleared_keys: [] });
        await screen.findByText('已清除全部 Django 快取');
        expect(djangoButton.querySelector('.spinner-border')).toBeNull();
    });

    test('載入並顯示 Django 具名快取', async () => {
        render(<CacheManagement />);

        expect(await screen.findByText('crawler_exam_site_html')).toBeInTheDocument();
        expect(screen.getByText('首頁消息（15 分鐘）')).toBeInTheDocument();
        expect(screen.getByText(/包含辭典搜尋、文法、聽力、句型、發音/))
            .toBeInTheDocument();
    });

    test('owner 可以清除全部 Django 快取', async () => {
        apiPost.mockResolvedValueOnce({
            cleared_keys: [
                'crawler_exam_site_html',
                'crawler_news_data',
                'crawler_exam_schedule_data',
            ],
        });

        render(<CacheManagement />);
        await screen.findByText('crawler_exam_site_html');
        fireEvent.click(screen.getByRole('button', {
            name: /清除全部 Django 快取/,
        }));

        await waitFor(() => {
            expect(apiPost).toHaveBeenCalledWith(
                '/adminapi/system/cache/clear-django/',
                {},
            );
        });
        expect(await screen.findByText('已清除全部 Django 快取'))
            .toBeInTheDocument();
        expect(screen.getAllByText('crawler_news_data')).toHaveLength(2);
    });

    test('owner 可以清除 FastAPI 快取並顯示失效數量', async () => {
        apiPost.mockResolvedValueOnce({
            result: {
                invalidated: {
                    words: 5,
                    grammar: 5,
                    grammar_affixes: 5,
                    grammar_quiz: 5,
                },
                rewarm: 'scheduled',
            },
        });

        render(<CacheManagement />);
        await screen.findByText('crawler_exam_site_html');
        fireEvent.click(screen.getByRole('button', {
            name: /清除全部 FastAPI 快取/,
        }));

        await waitFor(() => {
            expect(apiPost).toHaveBeenCalledWith(
                '/adminapi/system/cache/clear-fastapi/',
                {},
            );
        });
        expect(await screen.findByText('已清除 FastAPI 快取（重新預熱：進行中）'))
            .toBeInTheDocument();
        expect(screen.getByText('辭典搜尋：5')).toBeInTheDocument();
    });

    test('reviewer 只能檢視且看不到清除按鈕', async () => {
        mockRole = 'reviewer';
        render(<CacheManagement />);

        expect(await screen.findByText('crawler_exam_site_html')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /清除全部 Django 快取/ }))
            .not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /清除全部 FastAPI 快取/ }))
            .not.toBeInTheDocument();
        expect(screen.getByText(/只有擁有者或管理員可以執行清除/))
            .toBeInTheDocument();
    });

    test('FastAPI 呼叫失敗時顯示 detail 對應錯誤訊息', async () => {
        apiPost.mockRejectedValueOnce(
            new Error('INTERNAL_API_SECRET 未設定，無法通知 FastAPI 清除快取'),
        );

        render(<CacheManagement />);
        await screen.findByText('crawler_exam_site_html');
        fireEvent.click(screen.getByRole('button', {
            name: /清除全部 FastAPI 快取/,
        }));

        expect(await screen.findByText(
            'INTERNAL_API_SECRET 未設定，無法通知 FastAPI 清除快取',
        )).toBeInTheDocument();
    });

    test('初始載入失敗時顯示錯誤 Alert', async () => {
        apiGet.mockRejectedValueOnce(new Error('無法取得快取清單'));

        render(<CacheManagement />);

        expect(await screen.findByText('無法取得快取清單')).toBeInTheDocument();
    });
});
