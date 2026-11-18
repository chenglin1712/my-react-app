import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TribePill from './TribePill';

describe('TribePill', () => {
  const tribe = { name: '泰雅', color: '#123456' };

  test('active 為 false 時沒有 active class，也不再把族語色當背景', () => {
    const { container } = render(<TribePill tribe={tribe} active={false} onClick={vi.fn()} />);
    const button = container.querySelector('.yy-pill');
    expect(button).not.toHaveClass('active');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button.style.background).toBe('');
  });

  test('active 為 true 時只加 active class（選取狀態由共用樣式負責），族語色只出現在小圓點的 CSS 變數', () => {
    const { container } = render(<TribePill tribe={tribe} active onClick={vi.fn()} />);
    const button = container.querySelector('.yy-pill');
    expect(button).toHaveClass('active');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button.style.background).toBe('');
    expect(button.style.getPropertyValue('--tribe-color')).toBe('#123456');
    const dot = button.querySelector('.yy-pill__dot');
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveAttribute('aria-hidden', 'true');
  });

  test('沒有族語色的族群不畫圓點', () => {
    const { container } = render(<TribePill tribe={{ name: '未知' }} active={false} onClick={vi.fn()} />);
    expect(container.querySelector('.yy-pill__dot')).toBeNull();
  });

  test('沒有傳入 children 時顯示預設「族語」文字，點選會呼叫 onClick', () => {
    const onClick = vi.fn();
    render(<TribePill tribe={tribe} active={false} onClick={onClick} />);
    const button = screen.getByText('泰雅族語');
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
