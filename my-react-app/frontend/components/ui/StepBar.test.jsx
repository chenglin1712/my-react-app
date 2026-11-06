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

describe('StepBar 無障礙', () => {
  const steps = ['選擇圖片', '選字確認', '查詢結果'];

  test('是有序清單，目前步驟標 aria-current=step，其餘沒有', () => {
    render(<StepBar steps={steps} current={2} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).not.toHaveAttribute('aria-current');
    expect(items[2]).not.toHaveAttribute('aria-current');
  });

  test('完成的步驟顯示勾號並有「已完成」文字，不只靠顏色', () => {
    const { container } = render(<StepBar steps={steps} current={3} />);
    expect(container.querySelectorAll('.yy-step-diamond.done')[0].textContent).toBe('✓');
    expect(screen.getAllByText('（已完成）')).toHaveLength(2);
    expect(screen.getByText('（目前步驟）')).toBeInTheDocument();
  });
});

describe('StepBar 的分段進度變體（Apple 化步驟 4-4）', () => {
  const steps = ['上傳圖片', '選擇單詞', '查詢結果'];

  test('每一步是一段：走過的標 is-done、目前的標 is-active 並帶 aria-current，之後的都沒有', () => {
    const { container } = render(<StepBar steps={steps} current={2} variant="segments" />);
    const items = container.querySelectorAll('.yy-segstep');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveClass('is-done');
    expect(items[1]).toHaveClass('is-active');
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[2]).not.toHaveClass('is-done');
    expect(items[2]).not.toHaveClass('is-active');
    expect(items[2]).not.toHaveAttribute('aria-current');
    expect(container.querySelector('.yy-stepbar')).toHaveClass('yy-stepbar--segments');
  });

  test('狀態不只靠顏色：完成的步驟有勾號與「已完成」、目前步驟有「目前步驟」文字；橫條本身對讀屏隱藏', () => {
    const { container } = render(<StepBar steps={steps} current={2} variant="segments" />);
    expect(screen.getByText('（已完成）')).toBeInTheDocument();
    expect(screen.getByText('（目前步驟）')).toBeInTheDocument();
    expect(container.querySelector('.yy-segstep-num')).toHaveTextContent('✓');
    container.querySelectorAll('.yy-segstep-bar').forEach((bar) => expect(bar).toHaveAttribute('aria-hidden', 'true'));
  });

  test('預設仍是菱形，不受影響', () => {
    const { container } = render(<StepBar steps={steps} current={1} />);
    expect(container.querySelector('.yy-step-diamond')).not.toBeNull();
    expect(container.querySelector('.yy-segstep')).toBeNull();
  });
});
