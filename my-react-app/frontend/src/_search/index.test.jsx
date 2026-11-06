import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
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

// 詳情 sheet 用的 Offcanvas 內部會讀 matchMedia，jsdom 沒有，統一補一個「不符合任何查詢」的版本
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
});

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

describe('SearchPage 從連結直接查詞（AI 助手的詞條卡片，路線圖 #17）', () => {
  beforeEach(() => {
    apiPost.mockReset();
    apiPost.mockResolvedValue({ exact_match_results: [], fuzzy_match_results: {} });
  });
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  test('?q=詞&tribe=族語代號：第一次載入就用那個族語查那個詞，輸入框也帶著它', async () => {
    window.history.replaceState({}, '', '/search?q=lokah&tribe=amis');
    render(<SearchPage />);

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost.mock.calls[0][1]).toEqual({ keyword: 'lokah', tribe: '阿美' });
    expect(screen.getByLabelText('查詢關鍵字')).toHaveValue('lokah');
  });

  test('族語代號不合法就用預設族語，過長的詞會被截短', async () => {
    window.history.replaceState({}, '', `/search?q=${'a'.repeat(100)}&tribe=nothere`);
    render(<SearchPage />);

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost.mock.calls[0][1]).toEqual({ keyword: 'a'.repeat(60), tribe: '泰雅' });
  });

  test('沒有帶參數時維持原本的行為：載入全部詞條', async () => {
    window.history.replaceState({}, '', '/search');
    apiPost.mockResolvedValue({ all_results: {}, total: 0 });
    render(<SearchPage />);

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost.mock.calls[0][1]).toMatchObject({ tribe: '泰雅', limit: 50, offset: 0 });
    expect(apiPost.mock.calls[0][1]).not.toHaveProperty('keyword');
  });
});

describe('SearchPage 的空狀態與字母篩選（E-2）', () => {
  const word = (name) => ({ name, explanationItems: [{ chineseExplanation: '義' }] });

  beforeEach(() => {
    apiPost.mockReset();
  });

  const searchFor = async (keyword) => {
    fireEvent.change(await screen.findByLabelText('查詢關鍵字'), { target: { value: keyword } });
    fireEvent.keyDown(screen.getByLabelText('查詢關鍵字'), { key: 'Enter' });
  };

  test('開頭字母清單用後端回傳的實際字母（包含 d、f），不再寫死排除', async () => {
    apiPost.mockResolvedValue({ all_results: { 0: [word('balay')] }, total: 1, available_letters: ['b', 'd', 'f'] });
    render(<SearchPage />);
    await screen.findByText('balay');
    const group = screen.getByRole('group', { name: '開頭字母' });
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['b', 'd', 'f']);
  });

  test('後端沒有提供字母清單時用保底字母表，不排除 d、f、j、v', async () => {
    apiPost.mockResolvedValue({ all_results: { 0: [word('balay')] }, total: 1 });
    render(<SearchPage />);
    await screen.findByText('balay');
    const group = screen.getByRole('group', { name: '開頭字母' });
    ['d', 'f', 'j', 'v'].forEach((l) => expect(group.textContent).toContain(l));
  });

  test('關鍵字查不到：顯示「找不到」、建議，有篩選條件時可一鍵清除', async () => {
    apiPost.mockImplementation((url, body) => (
      body.keyword
        ? Promise.resolve({ exact_match_results: [], fuzzy_match_results: {} })
        : Promise.resolve({ all_results: { 0: [word('balay')] }, total: 1, available_letters: ['b'] })
    ));
    render(<SearchPage />);
    await screen.findByText('balay');
    fireEvent.click(screen.getByRole('button', { name: 'b' }));
    await searchFor('zzzz');

    expect(await screen.findByRole('heading', { name: '找不到「zzzz」' })).toBeInTheDocument();
    expect(screen.getByText(/目前的篩選條件：開頭「b」/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
    await waitFor(() => expect(screen.queryByText(/目前的篩選條件：開頭「b」/)).not.toBeInTheDocument());
  });

  test('關鍵字查不到時，「用詞形分析試試」會展開面板並帶入剛剛查的詞', async () => {
    apiPost.mockImplementation((url, body) => {
      if (String(url).includes('/morphology/')) {
        return Promise.resolve({
          tribe: '泰雅語', tribeSlug: 'tayal', input: body.word, normalized: body.word,
          token: { status: 'unknown', wordIds: [] }, candidates: [], rulesAvailable: true, admittedRuleCount: 2, notes: [],
        });
      }
      return body.keyword
        ? Promise.resolve({ exact_match_results: [], fuzzy_match_results: {} })
        : Promise.resolve({ all_results: {}, total: 0 });
    });
    render(<SearchPage />);
    await searchFor('mafiloo');
    fireEvent.click(await screen.findByRole('button', { name: '用詞形分析試試' }));

    await waitFor(() => expect(screen.getByLabelText('要分析的詞形')).toHaveValue('mafiloo'));
    const call = apiPost.mock.calls.find(([url]) => String(url).includes('/morphology/'));
    expect(call[1]).toEqual({ tribe: 'tayal', word: 'mafiloo' });
  });

  test('瀏覽全部詞條時篩選後 0 筆：說明目前條件，清除篩選後重新載入', async () => {
    apiPost.mockImplementation((url, body) => (
      body.letter
        ? Promise.resolve({ all_results: {}, total: 0, available_letters: ['b', 'c'] })
        : Promise.resolve({ all_results: { 0: [word('balay')] }, total: 1, available_letters: ['b', 'c'] })
    ));
    render(<SearchPage />);
    await screen.findByText('balay');
    fireEvent.click(screen.getByRole('button', { name: 'c' }));

    expect(await screen.findByRole('heading', { name: '目前的條件下沒有符合的詞' })).toBeInTheDocument();
    expect(screen.getByText(/開頭「c」/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
    expect(await screen.findByText('balay')).toBeInTheDocument();
  });
});

describe('SearchPage 的詳情 sheet 與查無結果建議（Apple 化步驟 4-2）', () => {
  const word = (name, gloss = '義') => ({ name, explanationItems: [{ chineseExplanation: gloss, partOfSpeech: '名詞' }] });

  beforeEach(() => {
    apiPost.mockReset();
  });

  test('點詞條開詳情 sheet，顯示該詞；按關閉鈕收起', async () => {
    apiPost.mockResolvedValue({ all_results: { 0: [word('balay', '真的')] }, total: 1 });
    render(<SearchPage />);
    fireEvent.click(await screen.findByRole('button', { name: /balay/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('balay');
    fireEvent.click(screen.getByRole('button', { name: '關閉詳情' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('查無結果時，建議可改用其他族語查同一個詞（保留關鍵字）', async () => {
    apiPost.mockImplementation((url, body) => {
      if (body.keyword) {
        return Promise.resolve(body.tribe === '阿美'
          ? { exact_match_results: [word('zzzz', '有了')], fuzzy_match_results: {} }
          : { exact_match_results: [], fuzzy_match_results: {} });
      }
      return Promise.resolve({ all_results: {}, total: 0 });
    });
    render(<SearchPage />);
    const input = await screen.findByLabelText('查詢關鍵字');
    fireEvent.change(input, { target: { value: 'zzzz' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByRole('heading', { name: '找不到「zzzz」' });

    const group = screen.getByRole('group', { name: '改用其他族語查「zzzz」' });
    expect(group).not.toHaveTextContent('改查泰雅族語');
    fireEvent.click(screen.getByRole('button', { name: '改查阿美族語' }));

    expect(await screen.findByText('有了')).toBeInTheDocument();
    expect(screen.getByLabelText('查詢關鍵字')).toHaveValue('zzzz');
    const lastKeywordCall = apiPost.mock.calls.filter(([, body]) => body.keyword).pop();
    expect(lastKeywordCall[1]).toEqual({ keyword: 'zzzz', tribe: '阿美' });
    // 改查只打一次關鍵字查詢，filter effect 不會補送一次瀏覽全部
    const afterClick = apiPost.mock.calls.filter(([, body]) => body.tribe === '阿美');
    expect(afterClick).toHaveLength(1);
  });
});

describe('SearchPage 的詞類篩選（Apple 化步驟 4-2）', () => {
  const word = (name, pos) => ({ name, explanationItems: [{ chineseExplanation: '義', partOfSpeech: pos }] });
  beforeEach(() => { apiPost.mockReset(); });

  const searchFor = async (keyword) => {
    fireEvent.change(await screen.findByLabelText('查詢關鍵字'), { target: { value: keyword } });
    fireEvent.keyDown(screen.getByLabelText('查詢關鍵字'), { key: 'Enter' });
  };
  const keywordResponse = () => (url, body) => (body.keyword
    ? Promise.resolve({ exact_match_results: [word('balay', '名詞'), word('musa', '動詞'), word('lokah', '名詞')], fuzzy_match_results: {} })
    : Promise.resolve({ all_results: { 0: [word('x', '名詞')] }, total: 1 }));

  test('瀏覽全部詞條（後端分頁）時不顯示詞類篩選', async () => {
    apiPost.mockImplementation(keywordResponse());
    render(<SearchPage />);
    await screen.findByText('x');
    expect(screen.queryByRole('group', { name: '依詞類篩選' })).toBeNull();
  });

  test('關鍵字結果有兩種以上詞性時出現篩選；選了只留符合的，選回「全部」還原', async () => {
    apiPost.mockImplementation(keywordResponse());
    render(<SearchPage />);
    await screen.findByText('x');
    await searchFor('a');
    await screen.findByText('musa');
    const group = screen.getByRole('group', { name: '依詞類篩選' });
    fireEvent.click(Array.from(group.querySelectorAll('button')).find((b) => b.textContent.startsWith('動詞')));
    expect(screen.getByText('musa')).toBeInTheDocument();
    expect(screen.queryByText('balay')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    expect(await screen.findByText('balay')).toBeInTheDocument();
  });

  test('新的查詢從「全部詞類」開始：舊選的詞類不會在之後的查詢裡自己復活', async () => {
    apiPost.mockImplementation(keywordResponse());
    render(<SearchPage />);
    await screen.findByText('x');
    await searchFor('a');
    await screen.findByText('musa');
    const first = screen.getByRole('group', { name: '依詞類篩選' });
    fireEvent.click(Array.from(first.querySelectorAll('button')).find((btn) => btn.textContent.startsWith('動詞')));
    expect(screen.queryByText('balay')).toBeNull();
    await searchFor('b');
    // 同樣的結果再來一次：沒有人重新選，所以名詞的詞條也要在
    expect(await screen.findByText('balay')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('切換族語會清掉詞類篩選', async () => {
    apiPost.mockImplementation(keywordResponse());
    render(<SearchPage />);
    await screen.findByText('x');
    await searchFor('a');
    await screen.findByText('musa');
    const group = screen.getByRole('group', { name: '依詞類篩選' });
    fireEvent.click(Array.from(group.querySelectorAll('button')).find((b) => b.textContent.startsWith('動詞')));
    fireEvent.click(screen.getByText('阿美族語'));
    await screen.findByText('x');
    expect(screen.queryByRole('group', { name: '依詞類篩選' })).toBeNull();
  });
});