import {
    beforeEach, describe, expect, test, vi,
} from 'vitest';
import {
    fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import GameSettings from './GameSettings';
import {
    apiDelete, apiGet, apiPatch, apiPost,
} from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
    apiDelete: vi.fn(),
    apiGet: vi.fn(),
    apiPatch: vi.fn(),
    apiPost: vi.fn(),
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

const baseWords = [
    {
        id: 1,
        word: 'apah',
        meaning: '糯米飯',
        sort_order: 0,
        created_by: 'owner-uid',
        updated_at: '2026-08-03T00:00:00Z',
    },
];

describe('GameSettings', () => {
    beforeEach(() => {
        mockRole = 'owner';
        apiDelete.mockReset();
        apiGet.mockReset();
        apiPatch.mockReset();
        apiPost.mockReset();

        apiGet.mockImplementation((url) => {
            if (url === '/adminapi/game-config/') return Promise.resolve(baseConfig);
            return Promise.resolve({ results: baseWords });
        });
    });

    test('載入並顯示目前遊戲參數及填字詞庫', async () => {
        render(<GameSettings />);

        expect(await screen.findByLabelText('聽力：每輪題數')).toHaveValue(10);
        // react-bootstrap 的 Nav/Nav.Link（沒有搭配 Tab.Container）渲染成
        // role="button" 而非 role="tab"，這個專案已經多次確認過（TaxonomyManager
        // 等既有分頁測試都用 getByRole('button', ...)），這裡沿用同一個慣例。
        fireEvent.click(screen.getByRole('button', { name: '填字詞庫（泰雅語）' }));

        expect(screen.getByText('apah')).toBeInTheDocument();
        expect(screen.getByText('糯米飯')).toBeInTheDocument();
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

    test('owner 可以新增填字詞庫資料', async () => {
        apiPost.mockResolvedValueOnce({
            id: 2,
            word: 'musa',
            meaning: '去',
            sort_order: 3,
        });

        render(<GameSettings />);
        await screen.findByLabelText('聽力：每輪題數');
        fireEvent.click(screen.getByRole('button', { name: '填字詞庫（泰雅語）' }));

        fireEvent.change(screen.getByLabelText('單字'), {
            target: { value: 'musa' },
        });
        fireEvent.change(screen.getByLabelText('中文提示'), {
            target: { value: '去' },
        });
        fireEvent.change(screen.getByLabelText('排序'), {
            target: { value: '3' },
        });
        fireEvent.click(screen.getByRole('button', { name: /新增/ }));

        await waitFor(() => {
            expect(apiPost).toHaveBeenCalledWith(
                '/adminapi/crossword-tayal-words/',
                { word: 'musa', meaning: '去', sort_order: 3 },
            );
        });
        expect(await screen.findByText('已新增「musa」')).toBeInTheDocument();
    });

    test('owner 可以編輯填字詞庫資料', async () => {
        apiPatch.mockResolvedValueOnce({
            ...baseWords[0],
            meaning: '小米糯米飯',
            sort_order: 2,
        });

        render(<GameSettings />);
        await screen.findByLabelText('聽力：每輪題數');
        fireEvent.click(screen.getByRole('button', { name: '填字詞庫（泰雅語）' }));
        fireEvent.click(screen.getByRole('button', { name: /編輯/ }));

        fireEvent.change(screen.getByLabelText('apah 中文提示'), {
            target: { value: '小米糯米飯' },
        });
        const row = screen.getByLabelText('apah 中文提示').closest('tr');
        fireEvent.click(within(row).getByRole('button', { name: /儲存/ }));

        await waitFor(() => {
            expect(apiPatch).toHaveBeenCalledWith(
                '/adminapi/crossword-tayal-words/1/',
                {
                    word: 'apah',
                    meaning: '小米糯米飯',
                    sort_order: 0,
                },
            );
        });
    });

    test('editor 僅能檢視，沒有儲存、新增、編輯或刪除操作', async () => {
        mockRole = 'editor';
        render(<GameSettings />);

        expect(await screen.findByLabelText('聽力：每輪題數')).toBeDisabled();
        expect(screen.queryByRole('button', { name: /儲存設定/ }))
            .not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '填字詞庫（泰雅語）' }));
        expect(screen.queryByLabelText('單字')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /編輯/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /刪除/ })).not.toBeInTheDocument();
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
