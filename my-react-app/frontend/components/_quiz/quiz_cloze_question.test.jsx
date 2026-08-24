import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ClozeQuestion from './quiz_cloze_question';

const QUESTION = {
  passage_ab: 'Yaba ＿＿＿ qutux.',
  passage_ch: '爸爸有一個。',
  options: ['balay', 'utux', 'hnigan', 'llyung'],
};

describe('ClozeQuestion', () => {
  test('顯示短文（含空格）與中譯，點擊選項回報 1-based 索引', () => {
    const onSelect = vi.fn();
    render(<ClozeQuestion question={QUESTION} selected={null} onSelect={onSelect} />);

    expect(screen.getByText('爸爸有一個。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /utux/ }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  test('selected 對應的選項有 aria-pressed=true', () => {
    render(<ClozeQuestion question={QUESTION} selected={2} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: /balay/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /utux/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
