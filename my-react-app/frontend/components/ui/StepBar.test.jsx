import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StepBar from './StepBar';

describe('StepBar', () => {
  const steps = ['選擇圖片', '選字確認', '查詢結果'];

  test('渲染所有步驟名稱', () => {
    render(<StepBar steps={steps} current={1} />);
    steps.forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  test('current 步驟標記為 active，之前的步驟標記為 done，之後的步驟兩者皆無', () => {
    const { container } = render(<StepBar steps={steps} current={2} />);
    const diamonds = container.querySelectorAll('.yy-step-diamond');

    expect(diamonds[0]).toHaveClass('done');
    expect(diamonds[0]).not.toHaveClass('active');

    expect(diamonds[1]).toHaveClass('active');
    expect(diamonds[1]).not.toHaveClass('done');

    expect(diamonds[2]).not.toHaveClass('active');
    expect(diamonds[2]).not.toHaveClass('done');
  });

  test('步驟之間有連接線，但最後一個步驟後面沒有', () => {
    const { container } = render(<StepBar steps={steps} current={1} />);
    expect(container.querySelectorAll('.yy-step-connector')).toHaveLength(steps.length - 1);
  });
});
