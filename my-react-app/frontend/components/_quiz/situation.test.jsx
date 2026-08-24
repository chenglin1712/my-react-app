import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Situation from './situation';
import { getUserSituation } from '../../src/userServives/uploadDb';

vi.mock('../../src/userServives/uploadDb', () => ({ getUserSituation: vi.fn() }));
// 圖表元件牽涉太多 recharts 細節，換成簡化版，只驗證 situation.jsx 有沒有
// 把正確的資料傳進去。
vi.mock('./situation_0judy_1.jsx', () => ({ default: ({ summary }) => <div data-testid="judy1">{summary.level}</div> }));
vi.mock('./situation_0judy_2.jsx', () => ({ default: ({ data }) => <div data-testid="judy2">{data.length}</div> }));
vi.mock('./situation_0judy_3.jsx', () => ({ default: () => <div data-testid="judy3" /> }));

describe('Situation', () => {
  beforeEach(() => {
    getUserSituation.mockReset();
  });

  test('載入中顯示載入文字', () => {
    getUserSituation.mockImplementation(() => new Promise(() => {}));
    render(<Situation />);
    expect(screen.getByText('資料載入中...')).toBeInTheDocument();
  });

  test('載入失敗時顯示錯誤訊息，跟「沒有資料」分開顯示（回歸測試：原本兩者都顯示成同一句「無符合條件的資料」）', async () => {
    getUserSituation.mockRejectedValue(new Error('network error'));
    render(<Situation />);
    expect(await screen.findByText('載入資料時發生錯誤，請稍後再試。')).toBeInTheDocument();
  });

  test('沒有答題紀錄時顯示尚無紀錄訊息', async () => {
    getUserSituation.mockResolvedValue(null);
    render(<Situation />);
    expect(await screen.findByText('尚無答題紀錄')).toBeInTheDocument();
  });

  test('有資料時把彙總資料傳給三個子元件，標題不顯示特定族語名稱（userSituation 是跨族語彙總）', async () => {
    getUserSituation.mockResolvedValue({
      level: '中級',
      speed: '快',
      advice: '多練習',
      radarData: [],
      monthlyAccuracy: [{ correctRate: 80 }],
      accuracyByType: [],
      questionTypeDistribution: {},
    });
    render(<Situation />);

    expect(await screen.findByTestId('judy1')).toHaveTextContent('中級');
    expect(screen.getByTestId('judy2')).toHaveTextContent('1');
    expect(screen.getByText('答題情形')).toBeInTheDocument();
  });
});
