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
const EMPTY_FAVORITES = [{ id: 1, content: [] }];
const favoritesHolder = vi.hoisted(() => ({ current: null }));
vi.mock('../../src/userServives/useFavorites', () => ({
  useFavorites: () => ({
    favorites: favoritesHolder.current,
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
    favoritesHolder.current = MOCK_FAVORITES;
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

describe('FavoritePage 空狀態（P1-12）', () => {
  beforeEach(() => {
    apiPost.mockReset();
  });

  test('收藏分類裡沒有任何詞：說明怎麼收藏，並提供前往單詞查詢的連結', async () => {
    favoritesHolder.current = EMPTY_FAVORITES;
    apiPost.mockResolvedValue({ all_results: {} });
    renderPage();

    expect(await screen.findByRole('heading', { name: '這個分類還沒有收藏的詞' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '去單詞查詢' })).toHaveAttribute('href', '/search');
  });
});

describe('FavoritePage 頁首與載入失敗（E-7，P1-14、P2-64）', () => {
  beforeEach(() => {
    apiPost.mockReset();
    favoritesHolder.current = MOCK_FAVORITES;
  });

  test('頁首不再是 sticky（不會被導覽列蓋住），套用全站頁面外殼與 h1', async () => {
    apiPost.mockResolvedValue({ all_results: { balay: [{ name: 'balay', explanationItems: [{ chineseExplanation: '真的' }] }] } });
    const { container } = renderPage();
    await waitFor(() => expect(screen.getAllByText('真的').length).toBeGreaterThan(0));

    expect(container.querySelector('.yy-page.favorite-page')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: '個人詞語庫' })).toBeInTheDocument();
    expect(container.querySelector('[style*="sticky"]')).toBeNull();
  });

  test('顯示目前族語的收藏數，切換族語時不會讓人以為收藏消失', async () => {
    apiPost.mockResolvedValue({ all_results: { balay: [{ name: 'balay', explanationItems: [] }, { name: 'cyux', explanationItems: [] }] } });
    renderPage();
    expect(await screen.findByText('泰雅族語已收藏 2 個詞')).toBeInTheDocument();
  });

  test('載入失敗：顯示人話訊息與重試鈕，按重試會重新查詢', async () => {
    // 依請求內容回應（不依呼叫順序）：機器忙時 400ms 後的收藏統計請求可能插在中間，不能吃掉查詢的回應
    let searchAttempts = 0;
    apiPost.mockImplementation((url, body) => {
      if (body && Array.isArray(body.names)) return Promise.resolve({ counts: {} });
      searchAttempts += 1;
      if (searchAttempts === 1) return Promise.reject(new Error('boom'));
      return Promise.resolve({ all_results: { balay: [{ name: 'balay', explanationItems: [{ chineseExplanation: '真的' }] }] } });
    });
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('單字資料暫時載入失敗，請稍後再試。');
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    await waitFor(() => expect(screen.getAllByText('真的').length).toBeGreaterThan(0));
    expect(searchAttempts).toBe(2);
  });
});

describe('FavoritePage 各族語收藏數（後端統計）', () => {
  beforeEach(() => {
    apiPost.mockReset();
    favoritesHolder.current = MOCK_FAVORITES;
  });

  function mockApi(counts) {
    apiPost.mockImplementation((url, body) => {
      if (body && Array.isArray(body.names)) {
        return counts instanceof Error ? Promise.reject(counts) : Promise.resolve({ counts });
      }
      return Promise.resolve({ all_results: { balay: [{ name: 'balay', explanationItems: [{ chineseExplanation: '真的' }] }, { name: 'cyux', explanationItems: [{ chineseExplanation: '看' }] }] } });
    });
  }

  test('把目前收藏的詞名送給後端，狀態列寫出其他族語的收藏數', async () => {
    mockApi({ tayal: 2, amis: 3, bunun: 0, kavalan: 0, paiwan: 1 });
    renderPage();

    expect(await screen.findByText(/其他族語：阿美 3、排灣 1/)).toBeInTheDocument();
    const summaryCall = apiPost.mock.calls.find(([, body]) => body && Array.isArray(body.names));
    expect(summaryCall[1]).toEqual({ names: ['balay', 'cyux'] });
    expect(screen.getByRole('status')).toHaveTextContent('泰雅族語已收藏 2 個詞');
  });

  test('族語下拉選單每個族語旁邊都有收藏數', async () => {
    mockApi({ tayal: 2, amis: 3, bunun: 0, kavalan: 0, paiwan: 1 });
    renderPage();
    await screen.findByText(/（其他族語/);

    fireEvent.click(screen.getByText('族語：泰雅'));
    expect(screen.getByText('3 個詞')).toBeInTheDocument();
    expect(screen.getByText('1 個詞')).toBeInTheDocument();
  });

  test('統計請求的網址一定是字串路徑（沒設環境變數的情況見 utils/apiUrls.test.js）', async () => {
    mockApi({ tayal: 2, amis: 3, bunun: 0, kavalan: 0, paiwan: 1 });
    renderPage();
    await screen.findByText(/其他族語：阿美 3、排灣 1/);
    const summaryCall = apiPost.mock.calls.find(([, body]) => body && Array.isArray(body.names));
    expect(typeof summaryCall[0]).toBe('string');
    expect(summaryCall[0].trim()).not.toBe('');
  });

  test('統計失敗時不影響收藏頁：沒有其他族語的數字，目前族語照常顯示', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockApi(new Error('boom'));
    renderPage();

    expect(await screen.findByText('泰雅族語已收藏 2 個詞')).toBeInTheDocument();
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(screen.queryByText(/（其他族語/)).not.toBeInTheDocument();
    spy.mockRestore();
  });
});

describe('FavoritePage 各族語收藏數：超過後端上限', () => {
  test('收藏超過 2000 個詞時不送統計請求（不顯示被截斷的數字）', async () => {
    apiPost.mockReset();
    favoritesHolder.current = [{ id: 1, content: Array.from({ length: 2001 }, (_, i) => `w${i}`) }];
    apiPost.mockResolvedValue({ all_results: {} });
    renderPage();
    await new Promise((r) => setTimeout(r, 600));
    expect(apiPost.mock.calls.some(([, body]) => body && Array.isArray(body.names))).toBe(false);
  });
});

describe('FavoritePage 只向後端要收藏的詞（不下載整個族語）', () => {
  const searchCalls = () => apiPost.mock.calls.filter(([, body]) => body && body.tribe);

  beforeEach(() => {
    apiPost.mockReset();
    apiPost.mockResolvedValue({ all_results: {} });
  });

  test('請求帶 favorites_only 與收藏詞名（所有分類的聯集），不是整個族語', async () => {
    favoritesHolder.current = [{ id: 1, content: ['balay', 'cyux'] }, { id: 2, content: ['cyux', 'qutux'] }];
    renderPage();
    await waitFor(() => expect(searchCalls()).toHaveLength(1));
    expect(searchCalls()[0][1]).toEqual({ tribe: '泰雅', favorites_only: true, favorite_names: ['balay', 'cyux', 'qutux'] });
  });

  test('收藏超過後端單次上限（500）時分批請求，結果合併', async () => {
    const names = Array.from({ length: 501 }, (_, i) => `w${i}`);
    favoritesHolder.current = [{ id: 1, content: names }];
    apiPost.mockImplementation((url, body) => Promise.resolve({
      all_results: Object.fromEntries(body.favorite_names.slice(0, 1).map((n) => [n, [{ name: n, explanationItems: [{ chineseExplanation: `義-${n}` }] }]])),
    }));
    renderPage();
    await waitFor(() => expect(searchCalls()).toHaveLength(2));
    expect(searchCalls().map(([, body]) => body.favorite_names.length)).toEqual([500, 1]);
    await waitFor(() => expect(screen.getAllByText('義-w0').length).toBeGreaterThan(0));
    expect(screen.getAllByText('義-w500').length).toBeGreaterThan(0);
  });

  test('沒有任何收藏時不發查詢請求（只有收藏統計那支另計）', async () => {
    favoritesHolder.current = EMPTY_FAVORITES;
    renderPage();
    await new Promise((r) => setTimeout(r, 50));
    expect(searchCalls()).toHaveLength(0);
  });

  test('離開頁面再回來（重新掛載）：用最新的收藏名單重新查詢', async () => {
    favoritesHolder.current = [{ id: 1, content: ['balay'] }];
    const first = renderPage();
    await waitFor(() => expect(searchCalls()).toHaveLength(1));
    first.unmount();
    favoritesHolder.current = [{ id: 1, content: ['balay', 'cyux'] }];
    renderPage();
    await waitFor(() => expect(searchCalls()).toHaveLength(2));
    expect(searchCalls()[1][1].favorite_names).toEqual(['balay', 'cyux']);
  });

  test('收藏資料比頁面晚到：從沒有變成有時補查一次', async () => {
    favoritesHolder.current = EMPTY_FAVORITES;
    const { rerender } = renderPage();
    await new Promise((r) => setTimeout(r, 20));
    expect(searchCalls()).toHaveLength(0);
    favoritesHolder.current = [{ id: 1, content: ['balay'] }];
    rerender(<MemoryRouter><FavoritePage /></MemoryRouter>);
    await waitFor(() => expect(searchCalls()).toHaveLength(1));
    expect(searchCalls()[0][1].favorite_names).toEqual(['balay']);
  });
});
