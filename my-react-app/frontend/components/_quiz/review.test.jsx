import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Review from './review';
import { getCurrentSituation, getQuizById } from '../../src/userServives/uploadDb';

vi.mock('../../src/userServives/uploadDb', () => ({
  getCurrentSituation: vi.fn(),
  getQuizById: vi.fn(),
  countScore: () => 100,
}));
vi.mock('./review_discussion', () => ({ default: () => <div>討論假資料</div> }));
vi.mock('./review_AI', () => ({ default: () => <div>AI助手</div> }));

function makeTimestamp(dateStr) {
  return { toDate: () => new Date(dateStr) };
}

const SITUATION = {
  id: 'situation-1',
  quizId: 'quiz-A',
  quizType: '中級',
  answeredAt: makeTimestamp('2026-03-05'),
  results: [{ isCorrect: true }],
  answers: [1],
  correctAnswers: [1],
};

const QUIZ_DATA = {
  title: '中級',
  createdAt: makeTimestamp('2020-01-01'),
  data: [{ question_ab: 'balay?', question_ch: '真的嗎？' }],
};

describe('Review（回歸測試：查看測驗詳情時用 answeredAt 而不是 createdAt，返回時清掉題目詳情）', () => {
  beforeEach(() => {
    getCurrentSituation.mockReset();
    getQuizById.mockReset();
  });

  test('查看測驗詳情後點返回，會回到列表，且題目詳情也一併清空', async () => {
    getCurrentSituation.mockResolvedValue([SITUATION]);
    getQuizById.mockResolvedValue(QUIZ_DATA);
    const user = userEvent.setup();
    render(<Review />);

    await user.click(await screen.findByRole('button', { name: '查看測驗' }));
    expect(await screen.findByText(/2026/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '查看題目' }));
    await screen.findByText('取消');
    expect(document.querySelector('.review-question-card .question-ab')).toHaveTextContent('balay?');

    await user.click(screen.getByRole('button', { name: /返回/ }));

    // 回到列表後，右側題目詳情不應該還留著剛剛看的那一題
    expect(screen.getByText('尚未選擇題目')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看測驗' })).toBeInTheDocument();
  });

  test('討論/AI助手分頁一開始就是 disabled', async () => {
    getCurrentSituation.mockResolvedValue([]);
    render(<Review />);

    expect(await screen.findByRole('button', { name: /討論/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /AI助手/ })).toBeDisabled();
  });
});
