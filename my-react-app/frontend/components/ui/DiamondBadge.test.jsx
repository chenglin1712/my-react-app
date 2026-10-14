import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DiamondBadge from './DiamondBadge';

describe('DiamondBadge', () => {
  test('未傳入 color/size/fontSize 時使用預設值', () => {
    const { container } = render(<DiamondBadge>1</DiamondBadge>);
    const badge = container.querySelector('.yy-diamond-badge');
    expect(badge.style.width).toBe('44px');
    expect(badge.style.height).toBe('44px');
    expect(badge.style.getPropertyValue('--yy-diamond-color')).toBe('var(--yy-red)');
    expect(badge.style.fontSize).toBe('15px');
  });

  test('傳入自訂 color/size/fontSize 會覆蓋預設值', () => {
    const { container } = render(<DiamondBadge color="#00ff00" size={60} fontSize={20}>2</DiamondBadge>);
    const badge = container.querySelector('.yy-diamond-badge');
    expect(badge.style.width).toBe('60px');
    expect(badge.style.height).toBe('60px');
    expect(badge.style.getPropertyValue('--yy-diamond-color')).toBe('#00ff00');
    expect(badge.style.fontSize).toBe('20px');
  });

  test('傳入的 style prop 會蓋過內建樣式（例如覆蓋顏色變數、加 margin）', () => {
    const { container } = render(
      <DiamondBadge color="#00ff00" style={{ '--yy-diamond-color': '#ff0000', margin: '0 auto' }}>3</DiamondBadge>,
    );
    const badge = container.querySelector('.yy-diamond-badge');
    expect(badge.style.getPropertyValue('--yy-diamond-color')).toBe('#ff0000');
    expect(badge.style.margin).toBe('0px auto');
  });

  test('children 會渲染在徽章內', () => {
    render(<DiamondBadge>7</DiamondBadge>);
    expect(screen.getByText('7')).toBeInTheDocument();
  });
});
