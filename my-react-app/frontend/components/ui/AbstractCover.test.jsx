import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import AbstractCover, { COVER_LAYOUTS } from './AbstractCover';

describe('AbstractCover（P1-5）', () => {
  test('純裝飾：aria-hidden，三塊玻璃，最前面一塊是銅色記號', () => {
    const { container } = render(<AbstractCover layout="pairs" />);
    const root = container.firstChild;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root.querySelectorAll('.yy-cover__gl')).toHaveLength(3);
    expect(root.querySelectorAll('.yy-cover__gl.is-key')).toHaveLength(1);
    expect(root.querySelectorAll('.yy-cover__bk i')).toHaveLength(4);
  });

  test('四種排法都存在，各有三層、層高遞增（後層低、前層高）', () => {
    expect(Object.keys(COVER_LAYOUTS).sort()).toEqual(['cross', 'keep', 'pairs', 'voice']);
    Object.values(COVER_LAYOUTS).forEach((shapes) => {
      expect(shapes).toHaveLength(3);
      const zs = shapes.map((s) => s.z);
      expect([...zs].sort((a, b) => a - b)).toEqual(zs);
    });
  });

  test('tone 對應 1 到 4 的色調，超出範圍會循環；不認得的排法退回 pairs', () => {
    const { container, rerender } = render(<AbstractCover tone={5} />);
    expect(container.firstChild).toHaveClass('yy-cover--tone1');
    rerender(<AbstractCover tone={4} layout="nope" />);
    expect(container.firstChild).toHaveClass('yy-cover--tone4');
    expect(container.querySelectorAll('.yy-cover__gl')).toHaveLength(3);
  });

  test('lite 版不進場、不掛游標光源；預設有進場 class', () => {
    const { container, rerender } = render(<AbstractCover />);
    expect(container.firstChild).toHaveClass('yy-cover--enter');
    rerender(<AbstractCover lite entrance={false} />);
    expect(container.firstChild).toHaveClass('yy-cover--lite');
    expect(container.firstChild).not.toHaveClass('yy-cover--enter');
  });
});
