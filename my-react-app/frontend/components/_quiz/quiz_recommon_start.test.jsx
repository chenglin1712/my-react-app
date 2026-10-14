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

  test('尚未開放的「收藏題庫」占位按鈕不顯示（P3-6）', () => {
    render(<RecommendedQuizStart />);
    expect(screen.queryByText(/收藏題庫/)).not.toBeInTheDocument();
    expect(screen.queryByText(/尚未開放/)).not.toBeInTheDocument();
  });
});
