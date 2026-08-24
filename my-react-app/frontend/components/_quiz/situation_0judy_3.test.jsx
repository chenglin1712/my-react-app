import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SituationDashboard from './situation_0judy_3';

vi.mock('recharts', () => {
  const Passthrough = ({ children }) => <div>{children}</div>;
  return {
    PieChart: Passthrough,
    Pie: ({ data }) => (
      <div data-testid="pie-data">
        {data.map((d) => <span key={d.name}>{d.name}</span>)}
      </div>
    ),
    Cell: () => null,
    ComposedChart: Passthrough,
    Bar: () => null,
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
    ResponsiveContainer: Passthrough,
  };
});

describe('SituationDashboard（回歸測試：原本未知的題型 key 會讓 typeMap[key] 是 undefined 進而拋錯）', () => {
  test('typeRatio 出現 typeMap 沒有的 key 時，用保底標籤顯示而不是拋錯', () => {
    expect(() => render(
      <SituationDashboard
        data={[]}
        typeRatio={{ trueFalse: 50, someNewType: 50 }}
      />
    )).not.toThrow();

    expect(screen.getAllByText('是非').length).toBeGreaterThan(0);
    expect(screen.getAllByText('其他題型').length).toBeGreaterThan(0);
  });
});
