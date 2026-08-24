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
