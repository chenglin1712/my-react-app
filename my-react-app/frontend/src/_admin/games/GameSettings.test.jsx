import {
    beforeEach, describe, expect, test, vi,
} from 'vitest';
import {
    fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import GameSettings from './GameSettings';
import { apiGet, apiPatch } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
    apiGet: vi.fn(),
    apiPatch: vi.fn(),
}));

let mockRole = 'owner';
vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

const baseConfig = {
    listening_questions_per_round: 10,
    listening_options_per_question: 4,
    sentence_questions_per_round: 8,
    sentence_options_per_question: 4,
    pronunciation_max_audio_mb: 5,
    pronunciation_excellent_threshold: 90,
    pronunciation_good_threshold: 75,
    pronunciation_fair_threshold: 60,
    pronunciation_pass_threshold: 70,
    crossword_grid_size: 12,
    crossword_min_word_length: 3,
    crossword_max_word_length: 10,
    crossword_words_per_round: 8,
    crossword_compute_time_limit_seconds: 5,
    updated_by: 'owner-uid',
    updated_at: '2026-08-03T00:00:00Z',
};

describe('GameSettings', () => {
    beforeEach(() => {
        mockRole = 'owner';
        apiGet.mockReset();
        apiPatch.mockReset();
        apiGet.mockResolvedValue(baseConfig);
    });

    test('載入並顯示目前遊戲參數', async () => {
        render(<GameSettings />);

        expect(await screen.findByLabelText('聽力：每輪題數')).toHaveValue(10);
        expect(apiGet).toHaveBeenCalledWith('/adminapi/game-config/');
        expect(apiGet).toHaveBeenCalledTimes(1);
    });

    test('owner 儲存時只送有改的欄位，並帶載入時的 updated_at（稽核 FE7a-11）', async () => {
        apiPatch.mockResolvedValueOnce({
            ...baseConfig,
            listening_questions_per_round: 12,
            updated_at: '2026-08-04T00:00:00Z',
        });

        render(<GameSettings />);
        const input = await screen.findByLabelText('聽力：每輪題數');
        fireEvent.change(input, { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));

        await waitFor(() => {
            expect(apiPatch).toHaveBeenCalledWith('/adminapi/game-config/', {
                listening_questions_per_round: 12,
                base_updated_at: '2026-08-03T00:00:00Z',
            });
        });
        expect(await screen.findByText('遊戲參數已儲存')).toBeInTheDocument();

        // 存成功後，下一次改帶回應裡的新版本
        apiPatch.mockResolvedValueOnce({ ...baseConfig, listening_questions_per_round: 13 });
        fireEvent.change(input, { target: { value: '13' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));
        await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(2));
        expect(apiPatch).toHaveBeenLastCalledWith('/adminapi/game-config/', {
            listening_questions_per_round: 13,
            base_updated_at: '2026-08-04T00:00:00Z',
        });
    });

    test('沒有任何變更時不送出請求', async () => {
        render(<GameSettings />);
        await screen.findByLabelText('聽力：每輪題數');
        fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));

        expect(await screen.findByText('沒有需要儲存的變更')).toBeInTheDocument();
        expect(apiPatch).not.toHaveBeenCalled();
    });

    test('清空欄位、小數或超出範圍都不會送出，並標示欄位（稽核 FE7a-11）', async () => {
        render(<GameSettings />);
        const input = await screen.findByLabelText('聽力：每輪題數');
        const save = screen.getByRole('button', { name: /儲存設定/ });

        fireEvent.change(input, { target: { value: '' } });
        fireEvent.click(save);
        expect(await screen.findByText('請填入整數')).toBeInTheDocument();
        expect(input).toHaveClass('is-invalid');

        fireEvent.change(input, { target: { value: '3.5' } });
        fireEvent.click(save);
        expect(await screen.findByText('請填入整數')).toBeInTheDocument();

        fireEvent.change(input, { target: { value: '99' } });
        fireEvent.click(save);
        expect(await screen.findByText('必須介於 1 到 50 之間')).toBeInTheDocument();

        expect(apiPatch).not.toHaveBeenCalled();
    });

    // WP-8 追加：摘要由欄位狀態即時推導，欄位改對後要自動消失（不是留在 error state）
    test('「有欄位需要修正」摘要在欄位改對後自動消失', async () => {
        render(<GameSettings />);
        const input = await screen.findByLabelText('聽力：每輪題數');

        fireEvent.change(input, { target: { value: '99' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));
        expect(await screen.findByText('有欄位需要修正，請看標示的欄位')).toBeInTheDocument();

        fireEvent.change(input, { target: { value: '12' } });
        await waitFor(() => expect(screen.queryByText('有欄位需要修正，請看標示的欄位')).not.toBeInTheDocument());
    });

    test('門檻順序與詞長上下限在前端就檢查', async () => {
        render(<GameSettings />);
        fireEvent.change(await screen.findByLabelText('發音：「優秀」門檻分數'), { target: { value: '50' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));
        expect(await screen.findByText(/優秀 ≥ 不錯 ≥ 繼續加油/)).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('發音：「優秀」門檻分數'), { target: { value: '90' } });
        fireEvent.change(screen.getByLabelText('填字：候選詞最短長度'), { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));
        expect(await screen.findByText('詞長下限不能大於上限')).toBeInTheDocument();
        expect(apiPatch).not.toHaveBeenCalled();
    });

    test('收到 409 edit_conflict：顯示「有人剛更新過」，按「載入最新版本」換成伺服器內容', async () => {
        apiPatch.mockRejectedValueOnce(Object.assign(new Error('衝突'), { status: 409, data: { code: 'edit_conflict' } }));
        render(<GameSettings />);
        const input = await screen.findByLabelText('聽力：每輪題數');
        fireEvent.change(input, { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));
        expect(await screen.findByText(/有人剛更新過/)).toBeInTheDocument();
        expect(input).toHaveValue(12);

        apiGet.mockResolvedValueOnce({ ...baseConfig, listening_questions_per_round: 20, updated_at: '2026-08-09T00:00:00Z' });
        fireEvent.click(screen.getByRole('button', { name: '載入最新版本' }));
        await waitFor(() => expect(input).toHaveValue(20));
        expect(screen.queryByText(/有人剛更新過/)).not.toBeInTheDocument();
    });

    test('editor 僅能檢視，沒有儲存操作', async () => {
        mockRole = 'editor';
        render(<GameSettings />);

        expect(await screen.findByLabelText('聽力：每輪題數')).toBeDisabled();
        expect(screen.queryByRole('button', { name: /儲存設定/ }))
            .not.toBeInTheDocument();
    });

    test('儲存失敗時顯示後端錯誤', async () => {
        // 後端驗證失敗：顯示具體原因，不只是「請求參數錯誤」（稽核 FE7a-05）
        apiPatch.mockRejectedValueOnce(Object.assign(new Error('請求參數錯誤'), {
            data: { errors: { non_field_errors: ['發音評分門檻必須維持順序'] } },
        }));

        render(<GameSettings />);
        fireEvent.change(await screen.findByLabelText('聽力：每輪題數'), { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));

        expect(await screen.findByText('發音評分門檻必須維持順序'))
            .toBeInTheDocument();
    });
});
