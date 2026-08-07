import {
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SearchAnalytics from './SearchAnalytics';
import { apiGet } from '../../../utils/apiClient';

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
}));

vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');

  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

let mockRole = 'owner';

vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({
    userData: { role: mockRole },
    loading: false,
  }),
}));

const searchAnalyticsData = {
  date_range: {
    start: '2026-08-01',
    end: '2026-08-07',
  },
  popular_queries: [
    { query: 'balay', count: 12 },
    { query: 'kolong', count: 7 },
  ],
  zero_result_queries: [
    { query: 'notarealword', count: 3 },
    { query: 'typo123', count: 1 },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <SearchAnalytics />
    </MemoryRouter>,
  );
}

describe('SearchAnalytics', () => {
  beforeEach(() => {
    mockRole = 'owner';
    mockNavigate.mockReset();
    apiGet.mockReset();
    apiGet.mockResolvedValue(searchAnalyticsData);
  });

  test('熱門查詢與查無結果詞表格正確渲染 API 資料', async () => {
    renderPage();

    expect(await screen.findByText('balay')).toBeInTheDocument();
    expect(screen.getByText('kolong')).toBeInTheDocument();
    expect(screen.getByText('notarealword')).toBeInTheDocument();
    expect(screen.getByText('typo123')).toBeInTheDocument();

    const popularPanel = screen.getByText('熱門查詢').closest('section');
    const zeroResultPanel = screen.getByText('查無結果詞').closest('section');

    expect(within(popularPanel).getByText('12')).toBeInTheDocument();
    expect(within(popularPanel).getByText('7')).toBeInTheDocument();
    expect(within(zeroResultPanel).getByText('3')).toBeInTheDocument();
    expect(within(zeroResultPanel).getByText('1')).toBeInTheDocument();

    expect(apiGet).toHaveBeenCalledWith(
      '/adminapi/analytics/search/?date_range=7d',
    );
  });

  test('兩份資料都是空陣列時，各自顯示暫無資料訊息', async () => {
    apiGet.mockResolvedValue({
      date_range: {
        start: '2026-08-01',
        end: '2026-08-07',
      },
      popular_queries: [],
      zero_result_queries: [],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getAllByText('此區間暫無資料')).toHaveLength(2);
    });

    expect(screen.getByText('熱門查詢')).toBeInTheDocument();
    expect(screen.getByText('查無結果詞')).toBeInTheDocument();
  });

  test('切換日期區間與族語會用正確 query 參數重新呼叫 API', async () => {
    renderPage();
    await screen.findByText('balay');

    fireEvent.change(screen.getByLabelText('日期區間'), {
      target: { value: '30d' },
    });

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        '/adminapi/analytics/search/?date_range=30d',
      );
    });

    fireEvent.change(screen.getByLabelText('族語'), {
      target: { value: 'tayal' },
    });

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        '/adminapi/analytics/search/?date_range=30d&tribe=tayal',
      );
    });
  });

  test('自訂日期填妥後帶正確日期與族語參數呼叫 API', async () => {
    renderPage();
    await screen.findByText('balay');

    fireEvent.change(screen.getByLabelText('日期區間'), {
      target: { value: 'custom' },
    });

    expect(
      screen.getByText('請選擇開始與結束日期'),
    ).toBeInTheDocument();

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
        '/adminapi/analytics/search/?date_range=custom&date_from=2026-07-01&date_to=2026-07-31&tribe=amis',
      );
    });
  });

  test.each(['owner', 'editor'])(
    '%s 看得到建立詞條草稿按鈕',
    async (role) => {
      mockRole = role;
      renderPage();

      expect(
        await screen.findByRole('button', {
          name: '建立「notarealword」詞條草稿',
        }),
      ).toBeInTheDocument();

      expect(
        screen.getByRole('button', {
          name: '建立「typo123」詞條草稿',
        }),
      ).toBeInTheDocument();
    },
  );

  test('點擊建立詞條草稿會用 prefillName state 導到新建詞條頁', async () => {
    renderPage();

    const button = await screen.findByRole('button', {
      name: '建立「notarealword」詞條草稿',
    });

    fireEvent.click(button);

    expect(mockNavigate).toHaveBeenCalledWith(
      '/admin/dictionary/words/new',
      {
        state: {
          prefillName: 'notarealword',
        },
      },
    );

    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  test.each(['analyst', 'reviewer'])(
    '%s 完全看不到建立詞條草稿按鈕',
    async (role) => {
      mockRole = role;
      renderPage();

      await screen.findByText('notarealword');

      expect(
        screen.queryByRole('button', {
          name: /建立.*詞條草稿/,
        }),
      ).not.toBeInTheDocument();

      expect(screen.queryByText('操作')).not.toBeInTheDocument();
    },
  );

  test('API 失敗時顯示錯誤訊息，頁面標題與篩選器仍正常顯示', async () => {
    apiGet.mockRejectedValue(
      new Error('搜尋分析資料載入失敗，請稍後再試'),
    );

    renderPage();

    expect(
      await screen.findByText('搜尋分析資料載入失敗，請稍後再試'),
    ).toBeInTheDocument();

    expect(screen.getByRole('heading', {
      name: '搜尋分析',
    })).toBeInTheDocument();

    expect(screen.getByLabelText('日期區間')).toBeInTheDocument();
    expect(screen.getByLabelText('族語')).toBeInTheDocument();
  });
});
