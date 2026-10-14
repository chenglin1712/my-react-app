import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import Dashboard from './Dashboard';
import { PENDING_QUEUES } from '../hooks/usePendingCounts';
import { apiGet } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({ apiGet: vi.fn() }));
vi.mock('recharts', () => {
  const Component = ({ children }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Component, LineChart: Component, BarChart: Component, CartesianGrid: () => null,
    XAxis: () => null, YAxis: () => null, Tooltip: () => null, Legend: () => null, Line: () => null,
    Bar: Component, Cell: () => null,
  };
});
vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({ userData: { role: 'editor' }, loading: false }),
}));

const renderWith = (pendingCounts) => render(
  <MemoryRouter>
    <Routes>
      <Route element={<Outlet context={{ pendingCounts }} />}>
        <Route index element={<Dashboard />} />
      </Route>
    </Routes>
  </MemoryRouter>,
);

describe('儀表板待辦事項（G-2）', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({ results: [], count: 0 });
  });

  test('只列出有待辦的佇列，並連到對應頁面', () => {
    renderWith({ '/admin/review': 4, '/admin/moderation/reports': 2, '/admin/moderation/notes': 0 });
    const panel = screen.getByRole('region', { name: '待辦事項' });
    expect(within(panel).getByRole('link', { name: /送審佇列/ })).toHaveAttribute('href', '/admin/review');
    expect(within(panel).getByRole('link', { name: /待處理檢舉/ })).toHaveAttribute('href', '/admin/moderation/reports');
    expect(within(panel).queryByText('被檢舉的分享筆記')).not.toBeInTheDocument();
  });

  test('六個佇列都載入完且都是 0：顯示「目前沒有待辦事項」', () => {
    renderWith(Object.fromEntries(PENDING_QUEUES.map((q) => [q.to, 0])));
    expect(screen.getByText('目前沒有待辦事項')).toBeInTheDocument();
  });

  test('有佇列載入失敗（null）但其餘都是 0：顯示沒有待辦，並註明部分取不到', () => {
    renderWith({ ...Object.fromEntries(PENDING_QUEUES.map((q) => [q.to, 0])), '/admin/verification': null });
    expect(screen.getByText('目前沒有待辦事項')).toBeInTheDocument();
    expect(screen.getByText(/部分佇列的待辦數暫時取不到/)).toBeInTheDocument();
  });

  test('還沒載入完且沒有任何待辦時，不先宣告沒事（整塊不顯示）', () => {
    renderWith({ '/admin/review': 0 });
    expect(screen.queryByRole('region', { name: '待辦事項' })).not.toBeInTheDocument();
    expect(screen.queryByText('目前沒有待辦事項')).not.toBeInTheDocument();
  });
});
