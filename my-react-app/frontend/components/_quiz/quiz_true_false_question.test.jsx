import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TrueFalseQuestion from './quiz_true_false_question';

const QUESTION = { image: 'q.png' };

describe('TrueFalseQuestion', () => {
  test('點擊 O/X 會回報 1/2', () => {
    const onSelect = vi.fn();
    render(<TrueFalseQuestion question={QUESTION} selected={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: 'O (符合)' }));
    expect(onSelect).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByRole('button', { name: 'X (不符合)' }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  test('selected 對應的按鈕有 aria-pressed=true', () => {
    render(<TrueFalseQuestion question={QUESTION} selected={2} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'O (符合)' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'X (不符合)' })).toHaveAttribute('aria-pressed', 'true');
  });
});
