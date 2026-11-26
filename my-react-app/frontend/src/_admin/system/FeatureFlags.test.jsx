import {
    beforeEach, describe, expect, test, vi,
} from 'vitest';
import {
    fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import FeatureFlags from './FeatureFlags';
import { apiGet, apiPatch } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
    apiGet: vi.fn(),
    apiPatch: vi.fn(),
}));

// 關閉功能開關前會先確認（稽核 FE7a-10）
const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock('@components/ui/ConfirmDialog', () => ({ confirmAction: confirmMock }));

let mockRole = 'owner';
vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

const baseResults = [
    {
        id: 1,
        key: 'quiz_enabled_tayal',
        label: '泰雅語測驗',
        description: '關閉後，泰雅語的官方等級測驗與情境題會回傳 403，不再出題。',
        enabled: true,
        updated_by: '',
        updated_at: null,
    },
    {
        id: 2,
        key: 'quiz_enabled_amis',
        label: '阿美語測驗',
        description: '控制阿美語測驗。',
        enabled: false,
        updated_by: 'admin-uid',
        updated_at: null,
    },
];

describe('FeatureFlags', () => {
    beforeEach(() => {
        mockRole = 'owner';
        apiGet.mockReset();
        apiPatch.mockReset();
        confirmMock.mockReset().mockResolvedValue(true);
        apiGet.mockResolvedValue({ results: baseResults });
    });

    test('關閉開關前先確認；取消則不送出請求、開關維持原狀（稽核 FE7a-10）', async () => {
        confirmMock.mockResolvedValue(false);
        render(<FeatureFlags />);
        const toggle = await screen.findByLabelText('泰雅語測驗 功能開關');
        fireEvent.click(toggle);

        await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
        expect(confirmMock.mock.calls[0][0].message).toMatch(/立即生效/);
        expect(apiPatch).not.toHaveBeenCalled();
        expect(toggle).toBeChecked();
    });

    test('開啟開關不需要確認', async () => {
        apiPatch.mockResolvedValueOnce({ ...baseResults[1], enabled: true });
        render(<FeatureFlags />);
        fireEvent.click(await screen.findByLabelText('阿美語測驗 功能開關'));

        await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/adminapi/feature-flags/2/', { enabled: true }));
        expect(confirmMock).not.toHaveBeenCalled();
    });

    test('驗證錯誤顯示具體原因，不只是「請求參數錯誤」（稽核 FE7a-05）', async () => {
        apiPatch.mockRejectedValueOnce(Object.assign(new Error('請求參數錯誤'), {
            data: { errors: { enabled: ['這個開關目前不能關閉'] } },
        }));
        render(<FeatureFlags />);
        fireEvent.click(await screen.findByLabelText('泰雅語測驗 功能開關'));

        expect(await screen.findByText('這個開關目前不能關閉')).toBeInTheDocument();
    });

    test('載入並顯示功能開關', async () => {
        render(<FeatureFlags />);

        expect(await screen.findByText('quiz_enabled_tayal')).toBeInTheDocument();
        expect(screen.getByLabelText('泰雅語測驗 功能開關')).toBeChecked();
        expect(screen.getByLabelText('阿美語測驗 功能開關')).not.toBeChecked();
    });

    test('owner 切換時立即 PATCH 對應功能', async () => {
        apiPatch.mockResolvedValueOnce({
            ...baseResults[0],
            enabled: false,
            updated_by: 'owner-uid',
        });

        render(<FeatureFlags />);
        const toggle = await screen.findByLabelText('泰雅語測驗 功能開關');
        fireEvent.click(toggle);

        await waitFor(() => {
            expect(apiPatch).toHaveBeenCalledWith(
                '/adminapi/feature-flags/1/',
                { enabled: false },
            );
        });
        expect(await screen.findByText('已關閉「泰雅語測驗」')).toBeInTheDocument();
    });

    // WP-8 追加：確認流程是非同步的，要用 waitFor 等 disabled 出現；回應回來後才能再操作
    test('送出中該開關會停用，PATCH 完成後恢復', async () => {
        let resolvePatch;
        apiPatch.mockReturnValueOnce(new Promise((resolve) => { resolvePatch = resolve; }));

        render(<FeatureFlags />);
        const toggle = await screen.findByLabelText('泰雅語測驗 功能開關');
        fireEvent.click(toggle);

        await waitFor(() => expect(toggle).toBeDisabled());

        resolvePatch({ ...baseResults[0], enabled: false, updated_by: 'owner-uid' });
        await waitFor(() => expect(toggle).not.toBeDisabled());
    });

    test('PATCH 失敗時顯示錯誤並還原開關', async () => {
        apiPatch.mockRejectedValueOnce(new Error('更新功能開關失敗'));

        render(<FeatureFlags />);
        const toggle = await screen.findByLabelText('泰雅語測驗 功能開關');
        fireEvent.click(toggle);

        expect(await screen.findByText('更新功能開關失敗')).toBeInTheDocument();
        await waitFor(() => expect(toggle).toBeChecked());
    });

    test('reviewer 可以檢視但開關不可操作', async () => {
        mockRole = 'reviewer';
        render(<FeatureFlags />);

        expect(await screen.findByLabelText('泰雅語測驗 功能開關'))
            .toBeDisabled();
        expect(screen.getByText(/只有擁有者或管理員可以變更/))
            .toBeInTheDocument();
    });

    test('載入失敗時顯示錯誤 Alert', async () => {
        apiGet.mockRejectedValueOnce(new Error('無法載入功能開關'));

        render(<FeatureFlags />);

        expect(await screen.findByText('無法載入功能開關')).toBeInTheDocument();
    });

    test('顯示真實判斷範圍提示', async () => {
        render(<FeatureFlags />);

        expect(await screen.findByText(/不是靜默顯示空題目/))
            .toBeInTheDocument();
    });
});
