import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import SearchPage from './index';
import { apiPost } from '../../utils/apiClient';
import { filterAndSortWords } from '../../utils/wordFilterSort';

// 把共用的篩選排序函式換成「照樣執行、但會記次數」的版本（O11）。
vi.mock('../../utils/wordFilterSort', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, filterAndSortWords: vi.fn(actual.filterAndSortWords) };
});
vi.mock('../../utils/apiClient', () => ({ apiPost: vi.fn() }));
// 真實的 useFavorites 回傳穩定的參照；mock 也要用同一個陣列，否則 favoriteWords 每次 render 都是新物件。
const { STABLE } = vi.hoisted(() => ({ STABLE: { favorites: [], toggleFavorite: () => {}, error: '' } }));
vi.mock('../../src/userServives/useFavorites', () => ({
  useFavorites: () => STABLE,
}));
vi.mock('../../hooks/useAudioPlayback', () => ({
  default: () => ({ playAudio: vi.fn(), playSentence: vi.fn(), failedAudio: new Set() }),
}));
vi.mock('../../hooks/useTranslateCapabilities', () => ({
  useTranslateCapabilities: () => null,
}));

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
});

const word = (name, zh) => ({ name, explanationItems: [{ chineseExplanation: zh }] });

describe('SearchPage：完全符合／相關符合的展平與排序只在資料或篩選變動時重算', () => {
  beforeEach(() => {
    apiPost.mockReset();
    filterAndSortWords.mockClear();
  });

  test('與結果無關的 render（例如輸入框打字）不會再排序一次', async () => {
    apiPost.mockImplementation((url, body) => (body.keyword
      ? Promise.resolve({
        exact_match_results: [word('balay', '真的'), word('cyux', '看')],
        fuzzy_match_results: { g: { x: [word('balayan', '真實')] } },
      })
      : Promise.resolve({ all_results: {}, total: 0 })));

    render(<SearchPage />);
    const input = await screen.findByLabelText('查詢關鍵字');
    fireEvent.change(input, { target: { value: 'balay' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getAllByText(/balay/).length).toBeGreaterThan(0));

    const callsAfterResults = filterAndSortWords.mock.calls.length;
    expect(callsAfterResults).toBeGreaterThan(0);

    // 只改輸入框文字（沒有送出查詢）：會 re-render，但結果與篩選條件都沒變。
    fireEvent.change(input, { target: { value: 'balay2' } });
    fireEvent.change(input, { target: { value: 'balay23' } });

    expect(filterAndSortWords.mock.calls.length).toBe(callsAfterResults);
    expect(screen.getAllByText(/balay/).length).toBeGreaterThan(0); // 畫面結果仍在
  });

  test('改排序方向這種真正會影響結果的條件，仍會重新排序', async () => {
    apiPost.mockImplementation((url, body) => (body.keyword
      ? Promise.resolve({ exact_match_results: [word('balay', '真的'), word('cyux', '看')], fuzzy_match_results: {} })
      : Promise.resolve({ all_results: {}, total: 0 })));

    render(<SearchPage />);
    const input = await screen.findByLabelText('查詢關鍵字');
    fireEvent.change(input, { target: { value: 'balay' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('cyux')).toBeInTheDocument());

    const before = filterAndSortWords.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /排序/ }));
    await waitFor(() => expect(filterAndSortWords.mock.calls.length).toBeGreaterThan(before));
  });
});
