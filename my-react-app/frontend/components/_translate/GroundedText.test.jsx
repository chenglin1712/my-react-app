import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import GroundedText from './GroundedText';

// FE3-08：逐詞佐證狀態要有報讀器讀得到的文字，不能只靠顏色與 title
describe('GroundedText 的佐證狀態文字', () => {
  const tokens = [
    { surface: 'balay', status: 'headword' },
    { surface: 'mqaras', status: 'attested' },
    { surface: 'lemintun', status: 'derived' },
    { surface: 'xyz', status: 'unsupported' },
    { surface: '。', status: 'punct' },
  ];

  test('每個非標點詞都帶視覺隱藏的狀態文字，可用名稱取得', () => {
    render(<GroundedText tokens={tokens} />);
    expect(screen.getByRole('button', { name: /balay.*有辭典佐證/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mqaras.*有辭典佐證/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lemintun.*有辭典佐證/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /xyz.*未找到佐證/ })).toBeInTheDocument();
  });

  test('狀態文字用 visually-hidden（畫面不變），標點不加', () => {
    const { container } = render(<GroundedText tokens={tokens} />);
    const hidden = container.querySelectorAll('.yy-gt-token .visually-hidden');
    expect(hidden).toHaveLength(4);
    expect(container.querySelector('.yy-gt-punct .visually-hidden')).toBeNull();
  });

  test('未知狀態不會唸出 undefined', () => {
    const { container } = render(<GroundedText tokens={[{ surface: 'foo', status: 'weird' }]} />);
    expect(container.textContent).not.toMatch(/undefined/);
  });
});
