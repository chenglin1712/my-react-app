import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WordFilterControls from './WordFilterControls';
import { countActiveFilters } from '../../utils/wordFilterState';

const setup = (overrides = {}) => {
  const props = {
    sortOrder: 'asc', onSortOrderChange: vi.fn(),
    filterLetter: '', onFilterLetterChange: vi.fn(),
    alphabet: ['a', 'b', "'"],
    frequencyFilter: '', onFrequencyFilterChange: vi.fn(),
    ...overrides,
  };
  render(<WordFilterControls {...props} />);
  return props;
};

describe('WordFilterControls', () => {
  test('排序鈕切換方向', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /排序：A → Z/ }));
    expect(props.onSortOrderChange).toHaveBeenCalledWith('desc');
  });

  test('字母 chip 有 aria-pressed，點選中的字母會取消選取', () => {
    const props = setup({ filterLetter: 'b' });
    expect(screen.getByRole('button', { name: 'b' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'a' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'a' }));
    expect(props.onFilterLetterChange).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByRole('button', { name: 'b' }));
    expect(props.onFilterLetterChange).toHaveBeenCalledWith('');
  });

  test('詞頻 chip：字串或數字的目前值都能辨識為選中，名稱是「N 星」', () => {
    const props = setup({ frequencyFilter: '3' });
    // 選中時多的勾號是 aria-hidden，不影響名稱
    expect(screen.getByRole('button', { name: '3 星' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '3 星' }));
    expect(props.onFrequencyFilterChange).toHaveBeenCalledWith('');
    fireEvent.click(screen.getByRole('button', { name: '5 星' }));
    expect(props.onFrequencyFilterChange).toHaveBeenCalledWith(5);
  });

  test('有給 onToggleFavorites 才顯示「只顯示收藏」，並帶 aria-pressed', () => {
    const toggle = vi.fn();
    setup({ onToggleFavorites: toggle, showOnlyFavorites: true });
    const button = screen.getByRole('button', { name: '只顯示收藏' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalled();
  });

  test('沒給 onToggleFavorites 就不顯示收藏鈕；字母表是空的就不顯示字母列', () => {
    setup({ alphabet: [] });
    expect(screen.queryByRole('button', { name: '只顯示收藏' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '開頭字母' })).not.toBeInTheDocument();
  });

  test('countActiveFilters：排序不算，字母、詞頻、收藏與額外條件都算', () => {
    expect(countActiveFilters({ filterLetter: '', frequencyFilter: '', showOnlyFavorites: false })).toBe(0);
    expect(countActiveFilters({ filterLetter: 'a', frequencyFilter: 3, showOnlyFavorites: true, extra: 1 })).toBe(4);
  });
});
