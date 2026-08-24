import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Game_Start from './game_start';
import { apiGet, apiPost } from '../../utils/apiClient';

vi.mock('../../utils/apiClient', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../src/userServives/useFavorites', () => ({
  useFavorites: () => ({ favorites: [], toggleFavorite: vi.fn(), error: null }),
}));

const VALID_RESPONSE = {
  grid_solution: ['ab'],
  legend: [],
  grid_display: ['  '],
};

describe('Game_Start（回歸測試：提交時原本會意外觸發填字題目重新產生）', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
  });

  async function startGame() {
    const user = userEvent.setup();
    render(<Game_Start tribe="tayal" />);
    await user.click(screen.getByRole('button', { name: '開始' }));
    await screen.findByText('橫向題目');
    return user;
  }

  test('題目載入完成前，「完成」按鈕是 disabled 的', async () => {
    let resolveFetch;
    apiGet.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const user = userEvent.setup();
    render(<Game_Start tribe="tayal" />);
    await user.click(screen.getByRole('button', { name: '開始' }));

    expect(screen.getByRole('button', { name: '完成' })).toBeDisabled();

    resolveFetch(VALID_RESPONSE);
    await waitFor(() => expect(screen.getByRole('button', { name: '完成' })).not.toBeDisabled());
  });

  test('點擊「完成」提交時，不會讓填字題目重新產生一份新的（回歸測試：原本 gameDataLoaded 是每次 render 都換身分的 callback，setSubmitting 觸發的重新渲染會讓子元件重新抓題目）', async () => {
    apiGet.mockResolvedValueOnce(VALID_RESPONSE);
    apiPost.mockResolvedValueOnce({ total_words: 1, correct_words_count: 1, word_details: [] });
    const user = await startGame();

    expect(apiGet).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '完成' }));

    // 提交只應該呼叫一次 apiPost，且不應該讓 apiGet（產生題目）被再叫一次
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  test('提交成功後顯示遊戲結果', async () => {
    apiGet.mockResolvedValueOnce(VALID_RESPONSE);
    apiPost.mockResolvedValueOnce({ total_words: 2, correct_words_count: 1, word_details: [] });
    const user = await startGame();

    await user.click(screen.getByRole('button', { name: '完成' }));

    expect(await screen.findByText('遊戲結果')).toBeInTheDocument();
  });

  test('提交失敗時顯示錯誤訊息，維持在遊戲畫面', async () => {
    apiGet.mockResolvedValueOnce(VALID_RESPONSE);
    apiPost.mockRejectedValueOnce(new Error('network down'));
    const user = await startGame();

    await user.click(screen.getByRole('button', { name: '完成' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('提交失敗');
    expect(screen.getByRole('button', { name: '完成' })).toBeInTheDocument();
  });
});
