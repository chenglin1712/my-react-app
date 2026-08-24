import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewAttemptDetail from './ReviewAttemptDetail';

function makeTimestamp(dateStr) {
  return { toDate: () => new Date(dateStr) };
}

describe('ReviewAttemptDetail（回歸測試：原本詳情標題顯示題目建立時間，不是使用者作答時間）', () => {
  test('標題顯示的是這次作答的時間（answeredAt），不是測驗題目本身的建立時間（createdAt）', () => {
    const quiz = {
      title: '中級',
      createdAt: makeTimestamp('2020-01-01'),
      answeredAt: makeTimestamp('2026-03-05'),
    };
    render(<ReviewAttemptDetail quiz={quiz} reviewQuestions={[]} onBack={vi.fn()} onViewQuestion={vi.fn()} />);

    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.queryByText(/2020/)).not.toBeInTheDocument();
  });

  test('點擊返回會呼叫 onBack', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<ReviewAttemptDetail quiz={{ title: 'x', answeredAt: makeTimestamp('2026-01-01') }} reviewQuestions={[]} onBack={onBack} onViewQuestion={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /返回/ }));
    expect(onBack).toHaveBeenCalled();
  });

  test('配合題等沒有 question_ab 的題目也有可讀的題目標籤', async () => {
    const reviewQuestions = [
      { idx: 0, item: { pairs: [{ cn: '你好' }] }, isCorrect: true },
    ];
    const onViewQuestion = vi.fn();
    const user = userEvent.setup();
    render(<ReviewAttemptDetail quiz={{ title: 'x', answeredAt: makeTimestamp('2026-01-01') }} reviewQuestions={reviewQuestions} onBack={vi.fn()} onViewQuestion={onViewQuestion} />);

    expect(screen.getByText('配合題')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '查看題目' }));
    expect(onViewQuestion).toHaveBeenCalledWith(0);
  });
});
