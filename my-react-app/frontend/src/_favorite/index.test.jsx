import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import FavoritePage from './index';
import { apiPost } from '../../utils/apiClient';

vi.mock('../../utils/apiClient', () => ({ apiPost: vi.fn() }));
// favorites 陣列參照要在多次 render 之間維持穩定：useTabState 依賴 [favorites]
// 判斷要不要重建 tabStates，每次呼叫都回傳新陣列會讓那個 effect 每次 render
// 都判定「favorites 變了」而一直重新觸發，造成無窮迴圈。
const MOCK_FAVORITES = [{ id: 1, content: ['balay', 'cyux'] }];
vi.mock('../../src/userServives/useFavorites', () => ({
  useFavorites: () => ({
    favorites: MOCK_FAVORITES,
    toggleFavorite: vi.fn(),
    error: '',
  }),
}));
vi.mock('../../hooks/useAudioPlayback', () => ({
  default: () => ({ playAudio: vi.fn(), failedAudio: new Set() }),
}));

function renderPage() {
  return render(<MemoryRouter><FavoritePage /></MemoryRouter>);
}

describe('FavoritePage（回歸測試：/favorite 已在 ProtectedLayout 底下，不需要自己再判斷登入狀態；切族語的競態防護）', () => {
  beforeEach(() => {
    apiPost.mockReset();
  });

  test('回歸測試：快速切換族語時，比較慢的舊族語回應不會蓋掉新族語已經顯示的結果', async () => {
    let resolveTayal;
    apiPost.mockImplementation((url, body) => {
      if (body.tribe === '泰雅') {
        return new Promise((resolve) => { resolveTayal = resolve; });
      }
      return Promise.resolve({ all_results: { cyux: [{ name: 'cyux', explanationItems: [{ chineseExplanation: '看' }] }] } });
    });

    renderPage();
    fireEvent.click(screen.getByText('族語：泰雅'));
    fireEvent.click(screen.getByText('阿美'));

    // 每張字卡的正/反兩面同時存在於 DOM（用 CSS 3D 翻轉切換可見的那一面），
    // 所以同一個詞會同時符合正面／背面兩個 <h5>，用 getAllByText 而不是 getByText。
    await waitFor(() => expect(screen.getAllByText('看').length).toBeGreaterThan(0));

    resolveTayal({ all_results: { balay: [{ name: 'balay', explanationItems: [{ chineseExplanation: '真的' }] }] } });
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText('真的')).not.toBeInTheDocument();
    expect(screen.getAllByText('看').length).toBeGreaterThan(0);
  });

  test('沒有登入相關的畫面（/favorite 交給 ProtectedLayout 統一處理），直接顯示收藏內容', async () => {
    apiPost.mockResolvedValue({ all_results: { balay: [{ name: 'balay', explanationItems: [{ chineseExplanation: '真的' }] }] } });

    renderPage();

    await waitFor(() => expect(screen.getAllByText('真的').length).toBeGreaterThan(0));
  });
});
