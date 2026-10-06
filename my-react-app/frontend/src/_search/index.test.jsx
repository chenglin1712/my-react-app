import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import SearchPage from './index';
import { apiPost } from '../../utils/apiClient';

vi.mock('../../utils/apiClient', () => ({ apiPost: vi.fn() }));
vi.mock('../../src/userServives/useFavorites', () => ({
  useFavorites: () => ({ favorites: [], toggleFavorite: vi.fn(), error: '' }),
}));
vi.mock('../../hooks/useAudioPlayback', () => ({
  default: () => ({ playAudio: vi.fn(), playSentence: vi.fn(), failedAudio: new Set() }),
}));
vi.mock('../../hooks/useTranslateCapabilities', () => ({
  useTranslateCapabilities: () => null,
}));

describe('SearchPage（回歸測試：全部詞條主查詢與載入更多的競態防護）', () => {
  beforeEach(() => {
    apiPost.mockReset();
  });

  test('快速切換族語時，比較慢的舊族語回應不會蓋掉新族語已經顯示的結果', async () => {
    let resolveTayal;
    apiPost.mockImplementation((url, body) => {
      if (body.tribe === '泰雅') {
        return new Promise((resolve) => { resolveTayal = resolve; });
      }
      return Promise.resolve({
        all_results: { cyux: [{ name: 'cyux', explanationItems: [{ chineseExplanation: '看' }] }] },
        total: 1,
      });
    });

    render(<SearchPage />);
    fireEvent.click(screen.getByText('阿美族語'));

    await waitFor(() => expect(screen.getByText('cyux')).toBeInTheDocument());

    resolveTayal({
      all_results: { balay: [{ name: 'balay', explanationItems: [{ chineseExplanation: '真的' }] }] },
      total: 1,
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText('balay')).not.toBeInTheDocument();
    expect(screen.getByText('cyux')).toBeInTheDocument();
  });

  test('回歸測試：快速連點兩次「載入更多」，只會真的送出一次額外的請求', async () => {
    apiPost.mockResolvedValue({
      all_results: { balay: [{ name: 'balay', explanationItems: [{ chineseExplanation: '真的' }] }] },
      total: 5,
    });

    render(<SearchPage />);
    await waitFor(() => expect(screen.getByText(/載入更多/)).toBeInTheDocument());

    let loadMoreCallCount = 0;
    apiPost.mockImplementation(() => {
      loadMoreCallCount += 1;
      return new Promise(() => {}); // 不 resolve，模擬還在載入中
    });

    const loadMoreButton = screen.getByRole('button', { name: /載入更多/ });
    fireEvent.click(loadMoreButton);
    fireEvent.click(loadMoreButton);

    expect(loadMoreCallCount).toBe(1);
  });

  test('回歸測試：「載入更多」還在等回應時如果又發出新的主查詢，過期的載入更多結果不會被 append', async () => {
    apiPost.mockResolvedValueOnce({
      all_results: { balay: [{ name: 'balay', explanationItems: [{ chineseExplanation: '真的' }] }] },
      total: 5,
    });

    render(<SearchPage />);
    await waitFor(() => expect(screen.getByText(/載入更多/)).toBeInTheDocument());

    let resolveLoadMore;
    apiPost.mockImplementationOnce(() => new Promise((resolve) => { resolveLoadMore = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: /載入更多/ }));

    // 載入更多還沒回來，切換族語觸發一次新的主查詢
    apiPost.mockResolvedValueOnce({
      all_results: { cyux: [{ name: 'cyux', explanationItems: [{ chineseExplanation: '看' }] }] },
      total: 1,
    });
    fireEvent.click(screen.getByText('阿美族語'));
    await waitFor(() => expect(screen.getByText('cyux')).toBeInTheDocument());

    // 過期的載入更多這時候才回來
    resolveLoadMore({
      all_results: { balay2: [{ name: 'balay2', explanationItems: [{ chineseExplanation: '真的2' }] }] },
      total: 5,
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText('balay2')).not.toBeInTheDocument();
    expect(screen.getByText('cyux')).toBeInTheDocument();
  });
});

describe('SearchPage 的詞形分析面板', () => {
  beforeEach(() => {
    apiPost.mockReset();
    apiPost.mockImplementation((url) => (
      String(url).includes('/morphology/')
        ? Promise.resolve({
          tribe: '阿美語', tribeSlug: 'amis', input: 'mafiloo', normalized: 'mafiloo',
          token: { status: 'unknown', wordIds: [] }, candidates: [], rulesAvailable: true, admittedRuleCount: 2,
          notes: ['辭典裡沒有這個詞形，也找不到可信的分析結果。'],
        })
        : Promise.resolve({ all_results: {}, total: 0 })
    ));
  });

  test('搜尋頁有詞形分析面板，預設收合', async () => {
    render(<SearchPage />);
    const toggle = await screen.findByRole('button', { name: /詞形分析/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('面板分析時用的是目前選的族語（slug），而不是搜尋用的中文簡稱', async () => {
    render(<SearchPage />);
    fireEvent.click(screen.getByText('阿美族語'));
    fireEvent.click(await screen.findByRole('button', { name: /詞形分析/ }));
    fireEvent.change(screen.getByLabelText('要分析的詞形'), { target: { value: 'mafiloo' } });
    fireEvent.click(screen.getByRole('button', { name: '分析' }));

    await waitFor(() => expect(screen.getByText('辭典查無此詞形')).toBeInTheDocument());
    const call = apiPost.mock.calls.find(([url]) => String(url).includes('/morphology/'));
    expect(call[1]).toEqual({ tribe: 'amis', word: 'mafiloo' });
  });

  test('切換族語會清掉上一個族語的分析結果', async () => {
    render(<SearchPage />);
    fireEvent.click(await screen.findByRole('button', { name: /詞形分析/ }));
    fireEvent.change(screen.getByLabelText('要分析的詞形'), { target: { value: 'mafiloo' } });
    fireEvent.click(screen.getByRole('button', { name: '分析' }));
    await screen.findByText('辭典查無此詞形');

    fireEvent.click(screen.getByText('布農族語'));
    await waitFor(() => expect(screen.queryByText('辭典查無此詞形')).not.toBeInTheDocument());
  });
});
