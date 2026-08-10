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
