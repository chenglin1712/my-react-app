import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TribePill from './TribePill';

describe('TribePill', () => {
  const tribe = { name: '泰雅', color: '#123456' };

  test('active 為 false 時不套用族語識別色，也沒有 active class', () => {
    const { container } = render(<TribePill tribe={tribe} active={false} onClick={vi.fn()} />);
    const button = container.querySelector('.yy-pill');
    expect(button).not.toHaveClass('active');
    expect(button.style.background).toBe('');
  });

  test('active 為 true 時套用 active class 與族語識別色背景', () => {
    const { container } = render(<TribePill tribe={tribe} active onClick={vi.fn()} />);
    const button = container.querySelector('.yy-pill');
    expect(button).toHaveClass('active');
    // jsdom 會把行內樣式的 hex 色碼正規化成 rgb()
    expect(button.style.background).toBe('rgb(18, 52, 86)');
  });

  test('沒有傳入 children 時顯示預設「族語」文字，點擊會呼叫 onClick', () => {
    const onClick = vi.fn();
    render(<TribePill tribe={tribe} active={false} onClick={onClick} />);
    const button = screen.getByText('泰雅族語');
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
