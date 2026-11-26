import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FavoriteButton from './FavoriteButton';

describe('FavoriteButton（P2-7）', () => {
  test('FE1-10：名稱固定帶詞彙、不隨狀態改變，狀態只由 aria-pressed 表達；點了呼叫 onToggle', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<FavoriteButton name="babaw" isFavorited={false} onToggle={onToggle} />);
    const btn = screen.getByRole('button', { name: '收藏「babaw」' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalled();
    rerender(<FavoriteButton name="babaw" isFavorited onToggle={onToggle} />);
    expect(screen.getByRole('button', { name: '收藏「babaw」' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('FE1-10：列表中多顆愛心可以用詞彙區分', () => {
    render(<>
      <FavoriteButton name="babaw" isFavorited={false} onToggle={vi.fn()} />
      <FavoriteButton name="lokah" isFavorited onToggle={vi.fn()} />
    </>);
    expect(screen.getByRole('button', { name: '收藏「babaw」' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收藏「lokah」' })).toBeInTheDocument();
  });

  test('按下「加入收藏」才彈跳；一開始就是已收藏不彈；取消收藏不彈；每次加入都會重新播放', () => {
    const { container, rerender } = render(<FavoriteButton name="x" isFavorited onToggle={vi.fn()} />);
    expect(container.querySelector('.is-pop')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '收藏「x」' }));
    expect(container.querySelector('.is-pop')).toBeNull();
    rerender(<FavoriteButton name="x" isFavorited={false} onToggle={vi.fn()} />);
    const before = container.querySelector('.yy-fav-heart');
    fireEvent.click(screen.getByRole('button', { name: '收藏「x」' }));
    rerender(<FavoriteButton name="x" isFavorited onToggle={vi.fn()} />);
    const after = container.querySelector('.yy-fav-heart');
    expect(after).toHaveClass('is-pop');
    expect(after).not.toBe(before); // 換了 key：重新掛上去，動畫重新播放
  });

  test('已收藏時愛心填色（不只靠顏色：aria-pressed 也變）', () => {
    const { container } = render(<FavoriteButton name="x" isFavorited onToggle={vi.fn()} />);
    expect(container.querySelector('svg')).toHaveAttribute('fill', 'currentColor');
  });
});
