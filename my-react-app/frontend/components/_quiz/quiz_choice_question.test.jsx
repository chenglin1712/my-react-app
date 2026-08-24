import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChoiceQuestion from './quiz_choice_question';

const QUESTION = { imageA: 'a.png', imageB: 'b.png', imageC: 'c.png' };

describe('ChoiceQuestion', () => {
  test('三個選項都是可鍵盤操作的 button，點擊會回報對應的 1-based 索引', () => {
    const onSelect = vi.fn();
    render(<ChoiceQuestion question={QUESTION} selected={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /選項 B/ }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  test('selected 對應的選項有 aria-pressed=true，其餘為 false', () => {
    render(<ChoiceQuestion question={QUESTION} selected={2} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: /選項 A/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /選項 B/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
