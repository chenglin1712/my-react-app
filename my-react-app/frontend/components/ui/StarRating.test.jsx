import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import StarRating from './StarRating';
import { frequencyToStarCount } from '../../utils/frequencyStars';

describe('frequencyToStarCount', () => {
  test.each([
    [0, 1], [200, 1],
    [201, 2], [400, 2],
    [401, 3], [800, 3],
    [801, 4], [1000, 4],
    [1001, 5], [5000, 5],
    [undefined, 1], [null, 1],
  ])('frequency %s -> %s 星', (fre, expected) => {
    expect(frequencyToStarCount(fre)).toBe(expected);
  });
});

describe('StarRating', () => {
  test('frequency 為 null／undefined 時不渲染任何內容', () => {
    const { container: c1 } = render(<StarRating frequency={null} />);
    expect(c1.textContent).toBe('');
    const { container: c2 } = render(<StarRating frequency={undefined} />);
    expect(c2.textContent).toBe('');
  });

  test('依詞頻數值渲染對應顆數的星星圖示，並附上數值標籤', () => {
    const { container } = render(<StarRating frequency={500} />);
    expect(container.querySelectorAll('svg').length).toBe(3);
    expect(container.textContent).toContain('500');
  });

  test('frequency 為 0 時顯示 1 顆星，且不會把 0 當成文字節點印出來', () => {
    const { container } = render(<StarRating frequency={0} />);
    expect(container.querySelectorAll('svg').length).toBe(1);
    expect(container.textContent).toBe('');
  });
});
