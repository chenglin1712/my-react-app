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

    test('owner 可以儲存整份遊戲參數', async () => {
        apiPatch.mockResolvedValueOnce({
            ...baseConfig,
            listening_questions_per_round: 12,
        });

        render(<GameSettings />);
        const input = await screen.findByLabelText('聽力：每輪題數');
        fireEvent.change(input, { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));

        await waitFor(() => {
            expect(apiPatch).toHaveBeenCalledWith(
                '/adminapi/game-config/',
                expect.objectContaining({
                    listening_questions_per_round: 12,
                    crossword_grid_size: 12,
                }),
            );
        });
        expect(await screen.findByText('遊戲參數已儲存')).toBeInTheDocument();
    });

    test('editor 僅能檢視，沒有儲存操作', async () => {
        mockRole = 'editor';
        render(<GameSettings />);

        expect(await screen.findByLabelText('聽力：每輪題數')).toBeDisabled();
        expect(screen.queryByRole('button', { name: /儲存設定/ }))
            .not.toBeInTheDocument();
    });

    test('儲存失敗時顯示後端錯誤', async () => {
        apiPatch.mockRejectedValueOnce(new Error('優秀、不錯與繼續加油門檻順序錯誤'));

        render(<GameSettings />);
        await screen.findByLabelText('聽力：每輪題數');
        fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));

        expect(await screen.findByText('優秀、不錯與繼續加油門檻順序錯誤'))
            .toBeInTheDocument();
    });
});
