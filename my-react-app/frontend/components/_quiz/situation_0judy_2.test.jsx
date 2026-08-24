import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SituationLine from './situation_0judy_2';

vi.mock('recharts', () => {
  const Passthrough = ({ children }) => <div>{children}</div>;
  return {
    ComposedChart: Passthrough,
    Bar: () => null,
    Area: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
    ResponsiveContainer: Passthrough,
    PieChart: Passthrough,
    Pie: ({ children }) => <div>{children}</div>,
    Cell: () => null,
  };
});

describe('SituationLine（回歸測試：原本 data 是空陣列時除以 0 得到 NaN）', () => {
  test('data 為空陣列時顯示 0，不是 NaN', () => {
    render(<SituationLine data={[]} />);
    expect(screen.getByText('0.0')).toBeInTheDocument();
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
  });

  test('data 都是有效值時正確計算平均', () => {
    render(<SituationLine data={[{ date: '1月', correctRate: 80 }, { date: '2月', correctRate: 60 }]} />);
    expect(screen.getByText('70.0')).toBeInTheDocument();
  });
});
