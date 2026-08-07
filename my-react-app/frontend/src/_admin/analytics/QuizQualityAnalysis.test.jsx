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
import QuizQualityAnalysis from './QuizQualityAnalysis';
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

vi.mock('recharts', () => {
  const Component = ({ children }) => <div>{children}</div>;

  return {
    ResponsiveContainer: Component,
    ScatterChart: Component,
    CartesianGrid: () => null,
    ReferenceArea: () => null,
    ReferenceLine: () => null,
    XAxis: Component,
    YAxis: Component,
    ZAxis: () => null,
    Label: () => null,
    Tooltip: () => null,
    Scatter: ({ data = [], shape }) => (
      <div data-testid="mock-scatter">
        {data.map((item, index) => (
          <div key={`${item.item_kind}-${item.item_id}`}>
            <span>{item.label}</span>
            <span>{item.accuracy_rate}</span>
            <span>{item.discrimination}</span>
            {shape({
              payload: item,
              cx: 20 + index,
              cy: 20 + index,
            })}
          </div>
        ))}
      </div>
    ),
  };
});

const qualityData = {
  date_range: {
    start: '2026-08-01',
    end: '2026-08-07',
  },
  respondent_count: 34,
  items: [
    {
      item_kind: 'true_false',
      item_id: 42,
      label: '這是狗。',
      list_path: '/admin/quiz-bank/true-false',
      attempt_count: 55,
      accuracy_rate: 0.82,
      discrimination: 0.35,
      sufficient_sample: true,
    },
    {
      item_kind: 'choice',
      item_id: 88,
      label: '請選出正確的族語詞。',
      list_path: '/admin/quiz-bank/choice',
      attempt_count: 37,
      accuracy_rate: 0.46,
      discrimination: -0.12,
      sufficient_sample: true,
    },
    {
      item_kind: 'cloze',
      item_id: '17:blank2',
      label: '很久以前，部落裡住著一位獵人…（blank2）',
      list_path: '/admin/quiz-bank/vocab',
      attempt_count: 8,
      accuracy_rate: 0.625,
      discrimination: null,
      sufficient_sample: false,
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <QuizQualityAnalysis />
    </MemoryRouter>,
  );
}

describe('QuizQualityAnalysis', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    apiGet.mockReset();
    apiGet.mockResolvedValue(qualityData);
  });

  test('正確渲染受試者數、散佈圖資料與樣本不足清單', async () => {
    renderPage();

    expect(await screen.findByText('這是狗。')).toBeInTheDocument();
    expect(
      screen.getByText('請選出正確的族語詞。'),
    ).toBeInTheDocument();

    expect(screen.getByText('34')).toBeInTheDocument();
    expect(screen.getByText('位受試者')).toBeInTheDocument();

    const insufficientPanel = screen
      .getByText('樣本不足清單')
      .closest('section');

    expect(
      within(insufficientPanel).getByText(
        '很久以前，部落裡住著一位獵人…（blank2）',
      ),
    ).toBeInTheDocument();

    expect(
      within(insufficientPanel).getByText('閱讀填空'),
    ).toBeInTheDocument();

    expect(
      within(insufficientPanel).getByText('63%'),
    ).toBeInTheDocument();

    expect(
      within(insufficientPanel).getByText(
        '樣本不足，尚無法判定鑑別度',
      ),
    ).toBeInTheDocument();

    expect(apiGet).toHaveBeenCalledWith(
      '/adminapi/analytics/quiz-quality/?date_range=7d',
    );
  });

  test('散佈圖與樣本不足清單都沒有資料時各自顯示暫無資料', async () => {
    apiGet.mockResolvedValue({
      date_range: {
        start: '2026-08-01',
        end: '2026-08-07',
      },
      respondent_count: 0,
      items: [],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getAllByText('此區間暫無資料')).toHaveLength(2);
    });

    expect(screen.queryByTestId('mock-scatter')).not.toBeInTheDocument();
  });

  test('切換日期區間與族語會帶正確 query 參數重新呼叫 API', async () => {
    renderPage();
    await screen.findByText('這是狗。');

    fireEvent.change(screen.getByLabelText('日期區間'), {
      target: { value: '30d' },
    });

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        '/adminapi/analytics/quiz-quality/?date_range=30d',
      );
    });

    fireEvent.change(screen.getByLabelText('族語'), {
      target: { value: 'bunun' },
    });

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        '/adminapi/analytics/quiz-quality/?date_range=30d&tribe=bunun',
      );
    });
  });

  test('自訂日期填妥後送出正確日期參數', async () => {
    renderPage();
    await screen.findByText('這是狗。');

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

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        '/adminapi/analytics/quiz-quality/?date_range=custom&date_from=2026-07-01&date_to=2026-07-31',
      );
    });
  });

  test('點擊散佈圖題目點會導到該題型的題庫列表', async () => {
    renderPage();

    const point = await screen.findByRole('button', {
      name: '查看題目：這是狗。',
    });

    fireEvent.click(point);

    expect(mockNavigate).toHaveBeenCalledWith(
      '/admin/quiz-bank/true-false',
    );
  });

  test('樣本不足清單的前往題庫按鈕也會正確導頁', async () => {
    renderPage();

    const button = await screen.findByRole('button', {
      name: '前往題庫查看：很久以前，部落裡住著一位獵人…（blank2）',
    });

    fireEvent.click(button);

    expect(mockNavigate).toHaveBeenCalledWith(
      '/admin/quiz-bank/vocab',
    );
  });

  test('API 失敗時顯示錯誤，頁面標題與篩選器仍正常顯示', async () => {
    apiGet.mockRejectedValue(
      new Error('題目品質資料載入失敗，請稍後再試'),
    );

    renderPage();

    expect(
      await screen.findByText('題目品質資料載入失敗，請稍後再試'),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', {
        name: '題目品質分析',
      }),
    ).toBeInTheDocument();

    expect(screen.getByLabelText('日期區間')).toBeInTheDocument();
    expect(screen.getByLabelText('族語')).toBeInTheDocument();
  });
});
