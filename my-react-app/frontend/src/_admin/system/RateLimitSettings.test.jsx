import {
    beforeEach, describe, expect, test, vi,
} from 'vitest';
import {
    fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import RateLimitSettings from './RateLimitSettings';
import { apiGet, apiPatch } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
    apiGet: vi.fn(),
    apiPatch: vi.fn(),
}));

let mockRole = 'owner';
vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

const baseResults = [
    {
        id: 1,
        key: 'user_create',
        backend: 'django',
        rate: '10/m',
        default_rate: '10/m',
        description: '後台建立使用者',
        updated_by: '',
        updated_at: null,
    },
    {
        id: 2,
        key: 'dictionary_search',
        backend: 'fastapi',
        rate: '30/m',
        default_rate: '60/m',
        description: '辭典搜尋',
        updated_by: 'admin-uid',
        updated_at: null,
    },
];

describe('RateLimitSettings', () => {
    beforeEach(() => {
        mockRole = 'owner';
        apiGet.mockReset();
        apiPatch.mockReset();
        apiGet.mockResolvedValue({ results: baseResults });
    });

    test('載入並顯示限流規則', async () => {
        render(<RateLimitSettings />);

        expect(await screen.findByText('user_create')).toBeInTheDocument();
        expect(screen.getByLabelText('user_create 限流值')).toHaveValue('10/m');
        // 「FastAPI」同時出現在後端篩選下拉選單的 <option> 與這一列的
        // Badge 裡，getByText 對唯一性比對會失敗——用 dictionary_search
        // 那一列的限流值輸入框往上找到 <tr>，把查詢範圍限定在該列。
        const fastapiRow = screen.getByLabelText('dictionary_search 限流值').closest('tr');
        expect(within(fastapiRow).getByText('FastAPI')).toBeInTheDocument();
    });

    test('變更值後 owner 可以儲存單一規則', async () => {
        apiPatch.mockResolvedValueOnce({
            ...baseResults[0],
            rate: '5/m',
            updated_by: 'owner-uid',
        });

        render(<RateLimitSettings />);
        const input = await screen.findByLabelText('user_create 限流值');
        const row = input.closest('tr');

        expect(within(row).getByRole('button', { name: /儲存/ })).toBeDisabled();
        fireEvent.change(input, { target: { value: '5/m' } });
        fireEvent.click(within(row).getByRole('button', { name: /儲存/ }));

        await waitFor(() => {
            expect(apiPatch).toHaveBeenCalledWith(
                '/adminapi/rate-limit-rules/1/',
                { rate: '5/m' },
            );
        });
        expect(await screen.findByText('已更新「user_create」的限流值'))
            .toBeInTheDocument();
    });

    describe('並行編輯保護（F8）', () => {
        const withStamp = (stamp) => baseResults.map((item) => ({ ...item, updated_at: stamp }));

        test('儲存時帶這條規則載入時的 updated_at；存成功後下一次改帶回應裡的新值', async () => {
            apiGet.mockResolvedValue({ results: withStamp('2026-08-01T00:00:00Z') });
            apiPatch.mockResolvedValueOnce({ ...baseResults[0], rate: '5/m', updated_at: '2026-08-02T00:00:00Z' });
            apiPatch.mockResolvedValueOnce({ ...baseResults[0], rate: '6/m', updated_at: '2026-08-03T00:00:00Z' });
            render(<RateLimitSettings />);
            const input = await screen.findByLabelText('user_create 限流值');
            const row = input.closest('tr');

            fireEvent.change(input, { target: { value: '5/m' } });
            fireEvent.click(within(row).getByRole('button', { name: /儲存/ }));
            await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
            expect(apiPatch).toHaveBeenLastCalledWith(
                '/adminapi/rate-limit-rules/1/', { rate: '5/m', base_updated_at: '2026-08-01T00:00:00Z' },
            );

            await screen.findByText('已更新「user_create」的限流值');
            fireEvent.change(input, { target: { value: '6/m' } });
            fireEvent.click(within(row).getByRole('button', { name: /儲存/ }));
            await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(2));
            expect(apiPatch).toHaveBeenLastCalledWith(
                '/adminapi/rate-limit-rules/1/', { rate: '6/m', base_updated_at: '2026-08-02T00:00:00Z' },
            );
        });

        test('每條規則各帶各的 updated_at，改一條不會影響另一條', async () => {
            apiGet.mockResolvedValue({
                results: [
                    { ...baseResults[0], updated_at: '2026-08-01T00:00:00Z' },
                    { ...baseResults[1], updated_at: '2026-08-05T00:00:00Z' },
                ],
            });
            apiPatch.mockResolvedValueOnce({ ...baseResults[1], rate: '9/minute', updated_at: '2026-08-06T00:00:00Z' });
            render(<RateLimitSettings />);
            const input = await screen.findByLabelText('dictionary_search 限流值');

            fireEvent.change(input, { target: { value: '9/minute' } });
            fireEvent.click(within(input.closest('tr')).getByRole('button', { name: /儲存/ }));

            await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
            expect(apiPatch).toHaveBeenLastCalledWith(
                `/adminapi/rate-limit-rules/${baseResults[1].id}/`, { rate: '9/minute', base_updated_at: '2026-08-05T00:00:00Z' },
            );
        });

        test('後端回 409（別人先改過這條）：顯示後端說明，使用者輸入的值保留，不顯示成功訊息', async () => {
            apiGet.mockResolvedValue({ results: withStamp('2026-08-01T00:00:00Z') });
            apiPatch.mockRejectedValueOnce(Object.assign(
                new Error('內容已被其他人更新，請重新整理頁面，確認最新內容後再編輯'), { status: 409 },
            ));
            render(<RateLimitSettings />);
            const input = await screen.findByLabelText('user_create 限流值');

            fireEvent.change(input, { target: { value: '5/m' } });
            fireEvent.click(within(input.closest('tr')).getByRole('button', { name: /儲存/ }));

            expect(await screen.findByText(/已被其他人更新/)).toBeInTheDocument();
            expect(screen.queryByText('已更新「user_create」的限流值')).not.toBeInTheDocument();
            expect(input).toHaveValue('5/m');
        });
    });

    test('後端篩選會用 query parameter 重新取得資料', async () => {
        render(<RateLimitSettings />);
        await screen.findByText('user_create');

        fireEvent.change(screen.getByLabelText('後端'), {
            target: { value: 'fastapi' },
        });

        await waitFor(() => {
            expect(apiGet).toHaveBeenLastCalledWith(
                '/adminapi/rate-limit-rules/?backend=fastapi',
            );
        });
    });

    test('文字搜尋會比對 key 或說明', async () => {
        render(<RateLimitSettings />);
        await screen.findByText('user_create');

        fireEvent.change(screen.getByPlaceholderText('搜尋 key 或說明'), {
            target: { value: '辭典' },
        });

        expect(screen.getByText('dictionary_search')).toBeInTheDocument();
        expect(screen.queryByText('user_create')).not.toBeInTheDocument();
    });

    test('重設按鈕把草稿改回預設值', async () => {
        render(<RateLimitSettings />);
        const input = await screen.findByLabelText('dictionary_search 限流值');
        const row = input.closest('tr');

        fireEvent.click(within(row).getByRole('button', {
            name: /重設為預設值/,
        }));

        expect(input).toHaveValue('60/m');
        expect(within(row).getByRole('button', { name: /儲存/ })).toBeEnabled();
    });

    test('reviewer 只能檢視且不能儲存', async () => {
        mockRole = 'reviewer';
        render(<RateLimitSettings />);

        expect(await screen.findByLabelText('user_create 限流值')).toBeDisabled();
        expect(screen.queryByRole('button', { name: /儲存/ }))
            .not.toBeInTheDocument();
    });

    test('儲存失敗時顯示錯誤訊息', async () => {
        apiPatch.mockRejectedValueOnce(new Error('限流格式不正確'));

        render(<RateLimitSettings />);
        const input = await screen.findByLabelText('user_create 限流值');
        const row = input.closest('tr');

        fireEvent.change(input, { target: { value: 'garbage' } });
        fireEvent.click(within(row).getByRole('button', { name: /儲存/ }));

        expect(await screen.findByText('限流格式不正確')).toBeInTheDocument();
    });
});
