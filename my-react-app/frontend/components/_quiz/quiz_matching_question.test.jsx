import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MatchingQuestion from './quiz_matching_question';

const QUESTION = {
  pairs: [
    { cn: '你好', word: { word: 'lokah' } },
    { cn: '謝謝', word: { word: 'mhway' } },
  ],
};

describe('MatchingQuestion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('配對全部正確時回報 1', () => {
    const onAnswer = vi.fn();
    render(<MatchingQuestion question={QUESTION} answered={false} resultValue={null} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByRole('button', { name: '你好' }));
    fireEvent.click(screen.getByRole('button', { name: 'lokah' }));
    fireEvent.click(screen.getByRole('button', { name: '謝謝' }));
    fireEvent.click(screen.getByRole('button', { name: 'mhway' }));

    expect(onAnswer).toHaveBeenCalledWith(1);
  });

  test('配錯一組立即結束整題並回報 2，顯示正確配對提示', () => {
    const onAnswer = vi.fn();
    render(<MatchingQuestion question={QUESTION} answered={false} resultValue={null} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByRole('button', { name: '你好' }));
    fireEvent.click(screen.getByRole('button', { name: 'mhway' }));

    expect(onAnswer).toHaveBeenCalledWith(2);
    expect(screen.getByText(/你好 的正確配對是「lokah」/)).toBeInTheDocument();

    // 已結束的題目，按鈕都應該被 disable，不能再繼續配對
    expect(screen.getByRole('button', { name: '你好' })).toBeDisabled();
  });

  test('answered=true 時顯示唯讀的解答總覽，不會讓使用者重新配對', () => {
    render(<MatchingQuestion question={QUESTION} answered resultValue={1} onAnswer={vi.fn()} />);

    expect(screen.getByText('本題配對全部正確')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '你好' })).not.toBeInTheDocument();
  });

  test('answered=true 但 resultValue 不是 1 時顯示「有誤」', () => {
    render(<MatchingQuestion question={QUESTION} answered resultValue={2} onAnswer={vi.fn()} />);

    expect(screen.getByText('本題配對有誤')).toBeInTheDocument();
  });
});
