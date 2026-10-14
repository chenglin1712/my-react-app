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

  test('配錯一組不會結束本題、也不揭露正解，可以再選（P2-57）', () => {
    const onAnswer = vi.fn();
    render(<MatchingQuestion question={QUESTION} answered={false} resultValue={null} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByRole('button', { name: '你好' }));
    fireEvent.click(screen.getByRole('button', { name: 'mhway' }));

    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByText('這兩個不是一組，再選一次。')).toBeInTheDocument();
    expect(screen.queryByText(/的正確配對是/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '你好' })).toBeEnabled();
  });

  test('配錯過再全部配對完成，回報 2（本題算答錯）', () => {
    const onAnswer = vi.fn();
    render(<MatchingQuestion question={QUESTION} answered={false} resultValue={null} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByRole('button', { name: '你好' }));
    fireEvent.click(screen.getByRole('button', { name: 'mhway' }));
    fireEvent.click(screen.getByRole('button', { name: '你好' }));
    fireEvent.click(screen.getByRole('button', { name: 'lokah' }));
    fireEvent.click(screen.getByRole('button', { name: '謝謝' }));
    fireEvent.click(screen.getByRole('button', { name: 'mhway' }));

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith(2);
    expect(screen.getByRole('button', { name: '你好' })).toBeDisabled();
  });

  test('作答前就把規則寫在題目上', () => {
    render(<MatchingQuestion question={QUESTION} answered={false} resultValue={null} onAnswer={vi.fn()} />);
    expect(screen.getByText(/配錯可以再選/)).toBeInTheDocument();
  });

  test('answered=true 時顯示唯讀的解答總覽，不會讓使用者重新配對', () => {
    render(<MatchingQuestion question={QUESTION} answered resultValue={1} onAnswer={vi.fn()} />);

    expect(screen.getByText('本題配對全部正確')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '你好' })).not.toBeInTheDocument();
    // 作答中不列出解答，正確配對在成績頁才看得到
    expect(screen.queryByText('lokah')).not.toBeInTheDocument();
  });

  test('answered=true 但 resultValue 不是 1 時顯示「有誤」', () => {
    render(<MatchingQuestion question={QUESTION} answered resultValue={2} onAnswer={vi.fn()} />);

    expect(screen.getByText('本題配對有誤')).toBeInTheDocument();
  });
});

describe('MatchingQuestion 配錯次數不會因為切題而歸零（E-6）', () => {
  test('先配錯、卸載再回來同一題，全部配對完成仍回報 2', () => {
    const onAnswer = vi.fn();
    const first = render(<MatchingQuestion question={QUESTION} answered={false} resultValue={null} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: '你好' }));
    fireEvent.click(screen.getByRole('button', { name: 'mhway' }));
    first.unmount();

    render(<MatchingQuestion question={QUESTION} answered={false} resultValue={null} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: '你好' }));
    fireEvent.click(screen.getByRole('button', { name: 'lokah' }));
    fireEvent.click(screen.getByRole('button', { name: '謝謝' }));
    fireEvent.click(screen.getByRole('button', { name: 'mhway' }));

    expect(onAnswer).toHaveBeenCalledWith(2);
  });
});
