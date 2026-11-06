import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import CelebrationBurst from './CelebrationBurst';
import { CELEBRATE_MIN_PCT, shouldCelebrate } from './celebrate';

describe('CelebrationBurst（Apple 化步驟 4-5）', () => {
  test('純裝飾：aria-hidden、12 個圓點，每個都有固定的位移與延遲序號（不用亂數）', () => {
    const { container } = render(<CelebrationBurst />);
    const root = container.querySelector('.game-celebrate');
    expect(root).toHaveAttribute('aria-hidden', 'true');
    const dots = root.querySelectorAll('.game-celebrate-dot');
    expect(dots).toHaveLength(12);
    dots.forEach((dot, i) => {
      expect(dot.style.getPropertyValue('--dx')).toMatch(/^-?\d+px$/);
      expect(dot.style.getPropertyValue('--dy')).toMatch(/^-?\d+px$/);
      expect(dot.style.getPropertyValue('--i')).toBe(String(i));
    });
  });

  test('每次渲染的結果一樣（可重現）', () => {
    const a = render(<CelebrationBurst />).container.innerHTML;
    const b = render(<CelebrationBurst />).container.innerHTML;
    expect(a).toBe(b);
  });

  test('達標門檻是 60%：59 不慶祝、60 與以上慶祝；不是有限數字不慶祝', () => {
    expect(CELEBRATE_MIN_PCT).toBe(60);
    expect(shouldCelebrate(59)).toBe(false);
    expect(shouldCelebrate(60)).toBe(true);
    expect(shouldCelebrate(100)).toBe(true);
    expect(shouldCelebrate(NaN)).toBe(false);
    expect(shouldCelebrate(undefined)).toBe(false);
  });
});
