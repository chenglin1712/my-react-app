import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import SearchPage from './index';
import { apiPost } from '../../utils/apiClient';

// 1200 個收藏詞名，超過後端 favorite_names 的單次上限 500（E6）。
const { FAVORITES } = vi.hoisted(() => ({
  FAVORITES: [{ id: 1, content: Array.from({ length: 1200 }, (_, i) => `n${String(i).padStart(4, '0')}`) }],
}));

vi.mock('../../utils/apiClient', () => ({ apiPost: vi.fn() }));
vi.mock('../../src/userServives/useFavorites', () => ({
  useFavorites: () => ({ favorites: FAVORITES, toggleFavorite: vi.fn(), error: '' }),
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

describe('SearchPage「只顯示收藏」：收藏超過後端單次上限時分批查詢', () => {
  beforeEach(() => {
    apiPost.mockReset();
    // 每一批只回該批第一個詞名，方便確認三批的結果有合併。
    apiPost.mockImplementation((url, body) => {
      const names = body.favorite_names || [];
      return Promise.resolve({
        all_results: names.length
          ? { 0: [{ name: names[0], explanationItems: [{ chineseExplanation: '詞' }] }] }
          : {},
        total: names.length ? 1 : 0,
        available_letters: ['n'],
      });
    });
  });

  test('收藏 1200 個詞時拆成 3 批、每批不超過 500，結果合併顯示', async () => {
    render(<SearchPage />);
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    apiPost.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /只顯示收藏/ }));

    await waitFor(() => expect(screen.getByText('n1000')).toBeInTheDocument());
    expect(screen.getByText('n0000')).toBeInTheDocument();
    expect(screen.getByText('n0500')).toBeInTheDocument();

    const favoriteCalls = apiPost.mock.calls.map(([, body]) => body).filter((body) => body.favorites_only);
    expect(favoriteCalls).toHaveLength(3);
    for (const body of favoriteCalls) {
      expect(body.favorite_names.length).toBeLessThanOrEqual(500);
      expect(body).not.toHaveProperty('limit'); // 分批時由前端自己切頁，不送 offset 分頁
    }
    expect(favoriteCalls.flatMap((body) => body.favorite_names)).toHaveLength(1200);
  });
});
