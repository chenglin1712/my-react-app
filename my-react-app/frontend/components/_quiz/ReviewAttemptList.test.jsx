import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewAttemptList from './ReviewAttemptList';

vi.mock('../../src/userServives/uploadDb', () => ({
  countScore: (results) => (results?.filter((r) => r.isCorrect).length ?? 0) * 100 / (results?.length || 1),
}));

function makeTimestamp(dateStr) {
  return { toDate: () => new Date(dateStr) };
}

describe('ReviewAttemptList（回歸測試：同一份測驗被作答兩次以上時原本用 quizId 當 key 會重複）', () => {
  test('同一個 quizId 的兩次作答紀錄各自用自己的 id 顯示，不會因為 key 重複而只顯示一筆', () => {
    const situations = [
      { id: 'situation-1', quizId: 'quiz-A', quizType: '初級', answeredAt: makeTimestamp('2026-01-01'), results: [{ isCorrect: true }] },
      { id: 'situation-2', quizId: 'quiz-A', quizType: '初級', answeredAt: makeTimestamp('2026-01-02'), results: [{ isCorrect: false }] },
    ];
    render(<ReviewAttemptList situations={situations} loading={false} onViewAttempt={vi.fn()} />);

    expect(screen.getAllByRole('button', { name: '查看測驗' })).toHaveLength(2);
  });

  test('點擊「查看測驗」會把整筆 situation 記錄回傳給呼叫端', async () => {
    const onViewAttempt = vi.fn();
    const user = userEvent.setup();
    const situation = { id: 'situation-1', quizId: 'quiz-A', quizType: '初級', answeredAt: makeTimestamp('2026-01-01'), results: [] };
    render(<ReviewAttemptList situations={[situation]} loading={false} onViewAttempt={onViewAttempt} />);

    await user.click(screen.getByRole('button', { name: '查看測驗' }));
    expect(onViewAttempt).toHaveBeenCalledWith(situation);
  });

  test('載入中顯示載入文字，沒有紀錄時顯示尚無紀錄文字', () => {
    const { rerender } = render(<ReviewAttemptList situations={[]} loading={true} onViewAttempt={vi.fn()} />);
    expect(screen.getByText('載入中...')).toBeInTheDocument();

    rerender(<ReviewAttemptList situations={[]} loading={false} onViewAttempt={vi.fn()} />);
    expect(screen.getByText('尚無答題紀錄')).toBeInTheDocument();
  });
});
