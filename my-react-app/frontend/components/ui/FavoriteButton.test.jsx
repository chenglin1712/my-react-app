import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FavoriteButton from './FavoriteButton';

describe('FavoriteButton（P2-7）', () => {
  test('aria-pressed 與名稱跟著收藏狀態；點了呼叫 onToggle', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<FavoriteButton name="babaw" isFavorited={false} onToggle={onToggle} />);
    const btn = screen.getByRole('button', { name: '加入收藏' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalled();
    rerender(<FavoriteButton name="babaw" isFavorited onToggle={onToggle} />);
    expect(screen.getByRole('button', { name: '取消收藏' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('按下「加入收藏」才彈跳；一開始就是已收藏不彈；取消收藏不彈；每次加入都會重新播放', () => {
    const { container, rerender } = render(<FavoriteButton name="x" isFavorited onToggle={vi.fn()} />);
    expect(container.querySelector('.is-pop')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '取消收藏' }));
    expect(container.querySelector('.is-pop')).toBeNull();
    rerender(<FavoriteButton name="x" isFavorited={false} onToggle={vi.fn()} />);
    const before = container.querySelector('.yy-fav-heart');
    fireEvent.click(screen.getByRole('button', { name: '加入收藏' }));
    rerender(<FavoriteButton name="x" isFavorited onToggle={vi.fn()} />);
    const after = container.querySelector('.yy-fav-heart');
    expect(after).toHaveClass('is-pop');
    expect(after).not.toBe(before); // 換了 key：重新掛上去，動畫重新播放
  });

  test('已收藏時愛心填色（不只靠顏色：aria-pressed 與名稱也變）', () => {
    const { container } = render(<FavoriteButton name="x" isFavorited onToggle={vi.fn()} />);
    expect(container.querySelector('svg')).toHaveAttribute('fill', 'currentColor');
  });
});
