import {
    beforeEach, describe, expect, test, vi,
} from 'vitest';
import {
    fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import RateLimitSettings from './RateLimitSettings';
import { apiGet, apiPatch } from '../../../utils/apiClient';

// 切換「後端」篩選且有未存草稿時會先確認（稽核 FE7a-20）
const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock('@components/ui/ConfirmDialog', () => ({ confirmAction: confirmMock }));

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
        rate: '30/minute',
        default_rate: '60/minute',
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
        confirmMock.mockReset().mockResolvedValue(true);
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
                new Error('內容已被其他人更新，請重新整理頁面，確認最新內容後再編輯'),
                { status: 409, data: { code: 'edit_conflict' } },
            ));
            render(<RateLimitSettings />);
            const input = await screen.findByLabelText('user_create 限流值');

            fireEvent.change(input, { target: { value: '5/m' } });
            fireEvent.click(within(input.closest('tr')).getByRole('button', { name: /儲存/ }));

            expect(await screen.findByText(/有人剛更新過/)).toBeInTheDocument();
            expect(screen.queryByText('已更新「user_create」的限流值')).not.toBeInTheDocument();
            expect(input).toHaveValue('5/m');
        });

        test('409 之後按「載入最新版本」：只重新載入那一條，取代草稿並換成新的 updated_at（稽核 FE7b-08）', async () => {
            apiGet.mockResolvedValue({ results: withStamp('2026-08-01T00:00:00Z') });
            apiPatch.mockRejectedValueOnce(Object.assign(new Error('衝突'), { status: 409, data: { code: 'edit_conflict' } }));
            render(<RateLimitSettings />);
            const input = await screen.findByLabelText('user_create 限流值');
            fireEvent.change(input, { target: { value: '5/m' } });
            fireEvent.click(within(input.closest('tr')).getByRole('button', { name: /儲存/ }));
            await screen.findByText(/有人剛更新過/);

            apiGet.mockResolvedValueOnce({ ...baseResults[0], rate: '20/m', updated_at: '2026-08-09T00:00:00Z' });
            fireEvent.click(screen.getByRole('button', { name: '載入最新版本' }));

            await waitFor(() => expect(input).toHaveValue('20/m'));
            expect(apiGet).toHaveBeenLastCalledWith('/adminapi/rate-limit-rules/1/');
            expect(screen.queryByText(/有人剛更新過/)).not.toBeInTheDocument();
        });
    });

    test('有未存草稿時切換「後端」先確認：取消則不切換、草稿保留；確認才切換並重新載入（稽核 FE7a-20）', async () => {
        render(<RateLimitSettings />);
        const input = await screen.findByLabelText('user_create 限流值');
        fireEvent.change(input, { target: { value: '5/m' } });

        confirmMock.mockResolvedValueOnce(false);
        fireEvent.change(screen.getByLabelText('後端'), { target: { value: 'fastapi' } });
        await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
        expect(confirmMock.mock.calls[0][0].message).toContain('1 筆');
        expect(screen.getByLabelText('後端')).toHaveValue('all');
        expect(input).toHaveValue('5/m');
        expect(apiGet).toHaveBeenCalledTimes(1);

        fireEvent.change(screen.getByLabelText('後端'), { target: { value: 'fastapi' } });
        await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/adminapi/rate-limit-rules/?backend=fastapi'));
    });

    test('沒有未存草稿時切換「後端」不跳確認', async () => {
        render(<RateLimitSettings />);
        await screen.findByText('user_create');
        fireEvent.change(screen.getByLabelText('後端'), { target: { value: 'django' } });
        await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/adminapi/rate-limit-rules/?backend=django'));
        expect(confirmMock).not.toHaveBeenCalled();
    });

    test('格式不正確時即時標示並停用儲存；單位要符合該規則的後端（稽核 FE7a-20）', async () => {
        render(<RateLimitSettings />);
        const djangoInput = await screen.findByLabelText('user_create 限流值');
        const fastapiInput = screen.getByLabelText('dictionary_search 限流值');

        fireEvent.change(djangoInput, { target: { value: 'garbage' } });
        expect(djangoInput).toHaveClass('is-invalid');
        expect(within(djangoInput.closest('tr')).getByRole('button', { name: /儲存/ })).toBeDisabled();

        fireEvent.change(djangoInput, { target: { value: '0/m' } });
        expect(djangoInput).toHaveClass('is-invalid');
        fireEvent.change(djangoInput, { target: { value: '20/minute' } });
        expect(djangoInput).toHaveClass('is-invalid'); // Django 規則不能用 FastAPI 的單位
        fireEvent.change(djangoInput, { target: { value: '5/m' } });
        expect(djangoInput).not.toHaveClass('is-invalid');

        fireEvent.change(fastapiInput, { target: { value: '5/m' } });
        expect(fastapiInput).toHaveClass('is-invalid');
        // 沒改過的列不標錯
        expect(screen.getByLabelText('user_create 限流值')).not.toHaveClass('is-invalid');
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

        expect(input).toHaveValue('60/minute');
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
        // 後端驗證失敗：顯示具體原因（稽核 FE7a-05），不是只有「請求參數錯誤」
        apiPatch.mockRejectedValueOnce(Object.assign(new Error('請求參數錯誤'), {
            data: { errors: { rate: ['換算後每秒 60.0 次請求，超過上限'] } },
        }));

        render(<RateLimitSettings />);
        const input = await screen.findByLabelText('user_create 限流值');
        const row = input.closest('tr');

        fireEvent.change(input, { target: { value: '9999/m' } });
        fireEvent.click(within(row).getByRole('button', { name: /儲存/ }));

        expect(await screen.findByText('換算後每秒 60.0 次請求，超過上限')).toBeInTheDocument();
    });
});
