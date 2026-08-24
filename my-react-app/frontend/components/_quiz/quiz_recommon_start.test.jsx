import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RecommendedQuizStart from './quiz_recommon_start';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

describe('RecommendedQuizStart（FR-4b）', () => {
  test('開始測驗會導向 question', () => {
    mockNavigate.mockReset();
    render(<RecommendedQuizStart />);

    fireEvent.click(screen.getByRole('button', { name: /開始測驗/ }));
    expect(mockNavigate).toHaveBeenCalledWith('question');
  });

  test('「收藏題庫」尚未有產品規格，顯示為 disabled（回歸測試：原本 onFavorite 從未被傳入，按鈕是看起來能用但完全無反應的假功能）', () => {
    render(<RecommendedQuizStart />);
    expect(screen.getByRole('button', { name: /收藏題庫/ })).toBeDisabled();
  });
});
