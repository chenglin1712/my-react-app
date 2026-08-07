import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from './Dashboard';
import { apiGet } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(),
}));

vi.mock('recharts', () => {
  const Chart = ({ children, data = [] }) => (
    <div data-testid="mock-chart">
      {data.map((item, index) => (
        <div key={`${item.date ?? item.tribe ?? item.event_type}-${index}`}>
          {Object.values(item).join(' ')}
        </div>
      ))}
      {children}
    </div>
  );

  const Component = ({ children }) => <div>{children}</div>;

  return {
    ResponsiveContainer: Component,
    LineChart: Chart,
    BarChart: Chart,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
    Line: ({ name }) => <span>{name}</span>,
    Bar: ({ name, children }) => <div><span>{name}</span>{children}</div>,
    Cell: () => null,
  };
});

let mockRole = 'owner';

vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({
    userData: { role: mockRole },
    loading: false,
  }),
}));

const analyticsData = {
  date_range: {
    start: '2026-08-01',
    end: '2026-08-07',
  },
  daily_active_users: [
    { date: '2026-08-01', count: 2 },
    { date: '2026-08-02', count: 5 },
  ],
  daily_new_registrations: [
    { date: '2026-08-01', count: 1 },
    { date: '2026-08-02', count: 3 },
  ],
  tribe_distribution: [
    { tribe: 'tayal', label: '泰雅語', count: 42 },
    { tribe: 'amis', label: '阿美語', count: 17 },
  ],
  feature_usage: [
    {
      event_type: 'dictionary_search',
      label: '辭典搜尋',
      count: 55,
    },
    {
      event_type: 'page_view',
      label: '頁面瀏覽',
      count: 30,
    },
  ],
};

const todayAnalyticsData = {
  ...analyticsData,
  date_range: {
    start: '2026-08-07',
    end: '2026-08-07',
  },
  daily_active_users: [
    { date: '2026-08-07', count: 12 },
  ],
  daily_new_registrations: [
    { date: '2026-08-07', count: 2 },
  ],
};

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

function installDefaultApiMock(chartData = analyticsData) {
  apiGet.mockImplementation((url) => {
    if (url.includes('/announcements/')) {
      return Promise.resolve({
        results: [],
        count: 5,
        page: 1,
        page_size: 1,
      });
    }

    if (url.includes('/audit-log/')) {
      return Promise.resolve({
        results: [
          {
            id: 1,
            actor_uid: 'owner-uid',
            actor_role: 'owner',
            action: 'approve',
            target_type: 'announcement',
            target_id: '9',
            created_at: '2026-08-02T03:00:00Z',
          },
        ],
      });
    }

    if (url === '/adminapi/analytics/dashboard/?date_range=today') {
      return Promise.resolve(todayAnalyticsData);
    }

    if (url === '/adminapi/analytics/dashboard/?date_range=7d') {
      return Promise.resolve(analyticsData);
    }

    if (url.startsWith('/adminapi/analytics/dashboard/?')) {
      return Promise.resolve(chartData);
    }

    return Promise.reject(new Error(`unexpected url: ${url}`));
  });
}

describe('Dashboard', () => {
  beforeEach(() => {
    mockRole = 'owner';
    apiGet.mockReset();
    installDefaultApiMock();
  });

  test('待審公告與兩張分析統計卡顯示 API 回傳的真實數字', async () => {
    renderDashboard();

    expect(await screen.findByText('5')).toBeInTheDocument();

    const activeCard = screen.getByText('今日活躍使用者')
      .closest('.admin-stat-card');
    const registrationCard = screen.getByText('本週新註冊')
      .closest('.admin-stat-card');

    expect(await within(activeCard).findByText('12')).toBeInTheDocument();
    expect(await within(registrationCard).findByText('4')).toBeInTheDocument();

    expect(apiGet).toHaveBeenCalledWith(
      '/adminapi/analytics/dashboard/?date_range=today',
    );
    expect(apiGet).toHaveBeenCalledWith(
      '/adminapi/analytics/dashboard/?date_range=7d',
    );
  });

  test('有資料時渲染每日趨勢、族語分布與功能使用熱度三個圖表', async () => {
    renderDashboard();

    expect(await screen.findByText('泰雅語')).toBeInTheDocument();
    expect(screen.getByText('阿美語')).toBeInTheDocument();
    // mock 的 BarChart 把整筆 data item 攤平成一個文字節點（見上面 vi.mock('recharts')），
    // 「辭典搜尋」不是獨立節點，要用子字串比對，不能用 getByText 的預設完全比對。
    expect(screen.getByText((content) => content.includes('辭典搜尋'))).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('頁面瀏覽'))).toBeInTheDocument();

    expect(screen.getByText('每日活躍與新註冊')).toBeInTheDocument();
    expect(screen.getByText('族語使用分布')).toBeInTheDocument();
    expect(screen.getByText('功能使用熱度')).toBeInTheDocument();
    expect(screen.getByText('活躍使用者')).toBeInTheDocument();
    expect(screen.getByText('新註冊')).toBeInTheDocument();
    expect(screen.getAllByTestId('mock-chart')).toHaveLength(3);
  });

  test('族語分布與功能使用資料為空陣列時顯示暫無資料', async () => {
    const emptyChartData = {
      ...analyticsData,
      tribe_distribution: [],
      feature_usage: [],
    };

    installDefaultApiMock(emptyChartData);

    apiGet.mockImplementation((url) => {
      if (url.includes('/announcements/')) {
        return Promise.resolve({ results: [], count: 5 });
      }
      if (url.includes('/audit-log/')) {
        return Promise.resolve({ results: [] });
      }
      if (url === '/adminapi/analytics/dashboard/?date_range=today') {
        return Promise.resolve(todayAnalyticsData);
      }
      if (url === '/adminapi/analytics/dashboard/?date_range=7d') {
        const sevenDayCalls = apiGet.mock.calls
          .filter(([calledUrl]) => (
            calledUrl === '/adminapi/analytics/dashboard/?date_range=7d'
          )).length;

        return Promise.resolve(
          sevenDayCalls >= 2 ? emptyChartData : analyticsData,
        );
      }
      return Promise.resolve(emptyChartData);
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getAllByText('此區間暫無資料')).toHaveLength(2);
    });

    expect(screen.getByText('每日活躍與新註冊')).toBeInTheDocument();
  });

  test('切換日期區間與族語會用正確 query 參數重新呼叫 API', async () => {
    renderDashboard();
    await screen.findByText('泰雅語');

    fireEvent.change(screen.getByLabelText('日期區間'), {
      target: { value: '30d' },
    });

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        '/adminapi/analytics/dashboard/?date_range=30d',
      );
    });

    fireEvent.change(screen.getByLabelText('族語'), {
      target: { value: 'tayal' },
    });

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        '/adminapi/analytics/dashboard/?date_range=30d&tribe=tayal',
      );
    });
  });

  test('自訂日期填妥後會帶 date_from、date_to 與族語參數呼叫 API', async () => {
    renderDashboard();
    await screen.findByText('泰雅語');

    fireEvent.change(screen.getByLabelText('日期區間'), {
      target: { value: 'custom' },
    });

    // 篩選器提示跟三個圖表面板的「尚未選好日期」佔位用的是同一句文字
    // （見 Dashboard.jsx），畫面上會同時出現 4 次，用 getAllByText 而不是
    // 預期唯一比對的 getByText。
    expect(screen.getAllByText('請選擇開始與結束日期').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('開始日期'), {
      target: { value: '2026-07-01' },
    });
    fireEvent.change(screen.getByLabelText('結束日期'), {
      target: { value: '2026-07-31' },
    });
    fireEvent.change(screen.getByLabelText('族語'), {
      target: { value: 'amis' },
    });

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        '/adminapi/analytics/dashboard/?date_range=custom&date_from=2026-07-01&date_to=2026-07-31&tribe=amis',
      );
    });
  });

  test('今日測驗完成與系統健康仍維持即將推出佔位', async () => {
    renderDashboard();
    await screen.findByText('5');

    const quizCard = screen.getByText('今日測驗完成')
      .closest('.admin-stat-card');

    expect(within(quizCard).getByText('—')).toBeInTheDocument();
    expect(within(quizCard).getByText('即將推出')).toBeInTheDocument();
    expect(screen.getAllByText('即將推出')).toHaveLength(1);

    expect(screen.getByText('系統健康')).toBeInTheDocument();
    expect(
      screen.getByText('尚未串接健康檢查資料'),
    ).toBeInTheDocument();
  });

  test('owner 看得到最近操作面板，內容來自 audit-log API', async () => {
    renderDashboard();

    expect(await screen.findByText(/owner-uid/)).toBeInTheDocument();
    expect(screen.getByText(/核准/)).toBeInTheDocument();

    expect(apiGet).toHaveBeenCalledWith(
      expect.stringContaining('/adminapi/audit-log/'),
    );
  });

  test('editor 看不到最近操作，也不會呼叫 audit-log API', async () => {
    mockRole = 'editor';
    renderDashboard();

    await screen.findByText('5');

    expect(screen.queryByText('最近操作')).not.toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalledWith(
      expect.stringContaining('/adminapi/audit-log/'),
    );
  });

  test('分析 API 失敗時顯示錯誤，其他儀表板內容仍可使用', async () => {
    apiGet.mockImplementation((url) => {
      if (url.includes('/announcements/')) {
        return Promise.resolve({ results: [], count: 5 });
      }
      if (url.includes('/audit-log/')) {
        return Promise.resolve({ results: [] });
      }
      if (url === '/adminapi/analytics/dashboard/?date_range=today') {
        return Promise.resolve(todayAnalyticsData);
      }
      if (url === '/adminapi/analytics/dashboard/?date_range=7d') {
        const sevenDayCalls = apiGet.mock.calls
          .filter(([calledUrl]) => (
            calledUrl === '/adminapi/analytics/dashboard/?date_range=7d'
          )).length;

        if (sevenDayCalls >= 2) {
          return Promise.reject(new Error('分析資料載入失敗'));
        }
        return Promise.resolve(analyticsData);
      }
      return Promise.reject(new Error('分析資料載入失敗'));
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getAllByText('分析資料載入失敗')).toHaveLength(3);
    });

    expect(screen.getByText('儀表板')).toBeInTheDocument();
    expect(screen.getByText('系統健康')).toBeInTheDocument();
  });

  test('待審公告 API 失敗時顯示錯誤，不會讓整個儀表板空白', async () => {
    apiGet.mockImplementation((url) => {
      if (url.includes('/announcements/')) {
        return Promise.reject(new Error('伺服器錯誤，請稍後再試'));
      }
      if (url.includes('/audit-log/')) {
        return Promise.resolve({ results: [] });
      }
      if (url === '/adminapi/analytics/dashboard/?date_range=today') {
        return Promise.resolve(todayAnalyticsData);
      }
      return Promise.resolve(analyticsData);
    });

    renderDashboard();

    expect(
      await screen.findByText('伺服器錯誤，請稍後再試'),
    ).toBeInTheDocument();
    expect(screen.getByText('儀表板')).toBeInTheDocument();
  });
});
