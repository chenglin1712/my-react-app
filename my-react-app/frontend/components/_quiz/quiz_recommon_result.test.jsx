import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import RecommendedQuizResult from './quiz_recommon_result';
import { apiGet } from '../../utils/apiClient';

let mockState = null;
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: mockState }),
  useNavigate: () => vi.fn(),
}));
vi.mock('../../utils/apiClient', () => ({ apiGet: vi.fn(), apiPut: vi.fn() }));

const baseState = { totalTime: '1:23', accuracy: 75, analysis: '分析文字', suggestion: '建議文字', modelSaveFailed: false };
const MA = 'v1|amis|P|ma||0';
const PA = 'v1|amis|P|pa||0';

describe('RecommendedQuizResult（詞綴診斷區塊）', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockRejectedValue(new Error('not available'));      // 預設：摘要與同意都不可用
  });

  test('沒有結果資料時顯示提示', () => {
    mockState = null;
    render(<RecommendedQuizResult />);
    expect(screen.getByText('沒有測驗結果，請重新測驗。')).toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalled();
  });

  test('舊版的結果資料（沒有 tribe 與診斷）仍可正常顯示，也不會去讀摘要', async () => {
    mockState = { ...baseState };
    render(<RecommendedQuizResult />);
    expect(screen.getByText('分析文字')).toBeInTheDocument();
    expect(screen.queryByTestId('rule-feedback')).not.toBeInTheDocument();
    // 只有同意卡片會去讀自己的端點，沒有 tribe 就不讀 rule_summary
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(apiGet.mock.calls.every(([url]) => !String(url).includes('rule_summary'))).toBe(true);
  });

  test('有診斷時顯示這次的詞綴診斷', () => {
    mockState = {
      ...baseState,
      ruleFeedback: [{ id: 'q1', diagnosis: { status: 'classified', errorType: 'wrong_affix', targetRule: MA, selectedRule: PA } }],
    };
    render(<RecommendedQuizResult />);
    expect(screen.getByTestId('rule-feedback')).toHaveTextContent('詞綴選錯了：這個詞用的是「ma-」，你選的詞形用了「pa-」。');
  });

  test('帶 tribe 時讀取摘要並顯示待加強的詞綴', async () => {
    mockState = { ...baseState, tribe: 'amis', ruleFeedback: [] };
    apiGet.mockImplementation((url) => (String(url).includes('rule_summary')
      ? Promise.resolve({ available: true, minObservations: 5, confusions: [], weakest: [{ rule: MA, label: 'ma-', p: 0.3, n: 7, c: 2 }] })
      : Promise.reject(new Error('no consent endpoint'))));
    render(<RecommendedQuizResult />);
    expect(await screen.findByText('你的詞綴熟練度（估計）')).toBeInTheDocument();
    const call = apiGet.mock.calls.find(([url]) => String(url).includes('rule_summary'));
    expect(call[1]).toEqual({ params: { tribe: 'amis' } });
  });

  test('摘要讀取失敗時頁面其餘內容不受影響', async () => {
    mockState = { ...baseState, tribe: 'amis', ruleFeedback: [] };
    render(<RecommendedQuizResult />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(screen.getByText('建議文字')).toBeInTheDocument();
    expect(screen.queryByTestId('rule-feedback')).not.toBeInTheDocument();
  });
});
