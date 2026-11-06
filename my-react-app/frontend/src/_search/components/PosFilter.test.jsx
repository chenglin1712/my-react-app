import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PosFilter, { MAX_POS_OPTIONS } from './PosFilter';

const OPTS = [{ pos: '名詞', count: 3 }, { pos: '動詞', count: 2 }];

describe('PosFilter（Apple 化步驟 4-2）', () => {
  test('少於兩種詞性時不顯示（沒有可篩的東西）', () => {
    const { container } = render(<PosFilter options={[{ pos: '名詞', count: 3 }]} value="" onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('「全部」加每種詞性一顆按鈕，aria-pressed 標示目前選取', () => {
    render(<PosFilter options={OPTS} value="動詞" onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: '依詞類篩選' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /動詞/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('點選回報詞性；點「全部」回報空字串', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<PosFilter options={OPTS} value="" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /名詞/ }));
    await user.click(screen.getByRole('button', { name: '全部' }));
    expect(onChange).toHaveBeenNthCalledWith(1, '名詞');
    expect(onChange).toHaveBeenNthCalledWith(2, '');
  });

  test('最多列出 MAX_POS_OPTIONS 種', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ pos: `詞${i}`, count: 10 - i }));
    render(<PosFilter options={many} value="" onChange={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(MAX_POS_OPTIONS + 1);
  });
});
