import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Game_result from './game_result';
import { useFavorites } from '../../src/userServives/useFavorites';

vi.mock('../../src/userServives/useFavorites', () => ({ useFavorites: vi.fn() }));

describe('Game_result（回歸測試：word_details 不是陣列時原本會直接拋錯）', () => {
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

  test('已收藏的單字顯示實心愛心，點擊會呼叫 toggleFavorite', async () => {
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
});
