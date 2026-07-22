import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DiamondBadge from './DiamondBadge';

describe('DiamondBadge', () => {
  test('未傳入 color/size/fontSize 時使用預設值', () => {
    const { container } = render(<DiamondBadge>1</DiamondBadge>);
    const badge = container.querySelector('.yy-diamond-badge');
    expect(badge.style.width).toBe('44px');
    expect(badge.style.height).toBe('44px');
    expect(badge.style.background).toBe('rgb(158, 27, 36)'); // #9E1B24
    expect(badge.style.fontSize).toBe('15px');
  });

  test('傳入自訂 color/size/fontSize 會覆蓋預設值', () => {
    const { container } = render(<DiamondBadge color="#00ff00" size={60} fontSize={20}>2</DiamondBadge>);
    const badge = container.querySelector('.yy-diamond-badge');
    expect(badge.style.width).toBe('60px');
    expect(badge.style.height).toBe('60px');
    expect(badge.style.background).toBe('rgb(0, 255, 0)');
    expect(badge.style.fontSize).toBe('20px');
  });

  test('傳入的 style prop 會蓋過內建樣式（例如覆蓋 background）', () => {
    const { container } = render(
      <DiamondBadge color="#00ff00" style={{ background: '#ff0000' }}>3</DiamondBadge>,
    );
    const badge = container.querySelector('.yy-diamond-badge');
    expect(badge.style.background).toBe('rgb(255, 0, 0)');
  });

  test('children 會渲染在徽章內', () => {
    render(<DiamondBadge>7</DiamondBadge>);
    expect(screen.getByText('7')).toBeInTheDocument();
  });
});
