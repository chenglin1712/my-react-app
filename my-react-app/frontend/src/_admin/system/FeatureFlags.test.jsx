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
        apiGet.mockResolvedValue({ results: baseResults });
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

        expect(toggle).toBeDisabled();
        await waitFor(() => {
            expect(apiPatch).toHaveBeenCalledWith(
                '/adminapi/feature-flags/1/',
                { enabled: false },
            );
        });
        expect(await screen.findByText('已關閉「泰雅語測驗」')).toBeInTheDocument();
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
