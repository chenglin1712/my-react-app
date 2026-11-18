import { describe, test, expect, vi, beforeEach } from 'vitest';
// P6-4：結算、繳交、收藏這些地方會記一次學習活動，需要知道目前登入者（見 src/_learning/studyStreak.js）。
vi.mock('../../src/userServives/authContext', () => ({ useAuth: () => ({ userData: { uid: 'test-uid' } }) }));

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Game_result from './game_result';
import { useFavorites } from '../../src/userServives/useFavorites';

vi.mock('../../src/userServives/useFavorites', () => ({ useFavorites: vi.fn() }));

describe('Game_result（回歸測試：word_details 不是陣列時原本會直接拋錯）', () => {
  beforeEach(() => { localStorage.clear(); });

  test('沒有 results 時不渲染任何內容', () => {
    useFavorites.mockReturnValue({ favorites: [], toggleFavorite: vi.fn(), error: null });
    const { container } = render(<Game_result results={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('word_details 缺漏或不是陣列時不會拋錯，視為沒有單字', () => {
    useFavorites.mockReturnValue({ favorites: [], toggleFavorite: vi.fn(), error: null });
    expect(() => render(<Game_result results={{ total_words: 0, correct_words_count: 0 }} />)).not.toThrow();
    expect(screen.getByText('沒有正確的單字。')).toBeInTheDocument();
    expect(screen.getByText('沒有錯誤的單字。')).toBeInTheDocument();
  });

  test('已收藏的單字顯示實心愛心，點選會呼叫 toggleFavorite', async () => {
    const toggleFavorite = vi.fn();
    useFavorites.mockReturnValue({
      favorites: [{ id: 1, content: ['balay'] }],
      toggleFavorite,
      error: null,
    });
    const user = userEvent.setup();
    render(<Game_result results={{
      total_words: 1,
      correct_words_count: 1,
      word_details: [{ clue: '線索', user_word: 'balay', correct_word: 'balay', is_correct: true }],
    }} />);

    expect(screen.getByRole('button', { name: '取消收藏' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消收藏' }));
    expect(toggleFavorite).toHaveBeenCalledWith('balay', 1);
  });

  const results = {
    total_words: 4,
    correct_words_count: 3,
    word_details: [
      { clue: 'a', user_word: 'a', correct_word: 'a', is_correct: true },
      { clue: 'b', user_word: 'b', correct_word: 'b', is_correct: true },
      { clue: 'c', user_word: 'c', correct_word: 'c', is_correct: true },
      { clue: 'd', user_word: 'x', correct_word: 'd', is_correct: false },
    ],
  };

  test('P4-4：分數環顯示答對率；第一次玩沒有上次紀錄就不顯示比較', () => {
    useFavorites.mockReturnValue({ favorites: [], toggleFavorite: vi.fn(), error: null });
    const { container } = render(<Game_result results={results} />);
    expect(container.querySelector('.game-result-ring')).toHaveStyle('--ring-pct: 75');
    expect(screen.getByText('答對 3 / 4 個單字')).toBeInTheDocument();
    expect(container.querySelector('.game-result-compare')).toBeNull();
  });

  test('P4-4：有上次紀錄時顯示進步／退步，並把這次成績存起來給下次比較', () => {
    useFavorites.mockReturnValue({ favorites: [], toggleFavorite: vi.fn(), error: null });
    localStorage.setItem('yy.game.crossword.lastResult', JSON.stringify({ pct: 50, at: 1 }));
    render(<Game_result results={results} />);
    expect(screen.getByText(/比上次進步 25%/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('yy.game.crossword.lastResult')).pct).toBe(75);
  });

  test('P4-4：錯詞一鍵加入收藏，只加還沒收藏的；全部收藏後按鈕停用', async () => {
    const toggleFavorite = vi.fn().mockResolvedValue(undefined);
    useFavorites.mockReturnValue({ favorites: [], toggleFavorite, error: null });
    const user = userEvent.setup();
    const { unmount } = render(<Game_result results={results} />);
    await user.click(screen.getByRole('button', { name: '把 1 個錯詞加入收藏複習' }));
    expect(toggleFavorite).toHaveBeenCalledTimes(1);
    expect(toggleFavorite).toHaveBeenCalledWith('d', 1);
    unmount();
    useFavorites.mockReturnValue({ favorites: [{ id: 1, content: ['d'] }], toggleFavorite, error: null });
    render(<Game_result results={results} />);
    expect(screen.getByRole('button', { name: '錯詞都已加入收藏' })).toBeDisabled();
  });
});
