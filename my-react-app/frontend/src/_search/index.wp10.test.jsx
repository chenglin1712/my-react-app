import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import SearchPage from './index';
import { apiPost } from '../../utils/apiClient';
import useAudioPlayback from '../../hooks/useAudioPlayback';

// 稽核 WP-10（FE3-01、FE3-02、FE3-05、FE3-13、FE3-15）：單詞查詢頁對訪客開放後的錯誤分類、送出前整理、
// 發音錯誤不進主錯誤框、換篩選不插骨架、詳情換詞後關閉的焦點。
vi.mock('../../utils/apiClient', () => ({ apiPost: vi.fn() }));
vi.mock('../../src/userServives/useFavorites', () => ({
  useFavorites: () => ({ favorites: [], toggleFavorite: vi.fn(), error: '' }),
}));
vi.mock('../../hooks/useAudioPlayback', () => ({
  default: vi.fn(() => ({ playAudio: vi.fn(), playSentence: vi.fn(), failedAudio: new Set(), sentenceFailure: null })),
}));
vi.mock('../../hooks/useTranslateCapabilities', () => ({
  useTranslateCapabilities: () => null,
}));

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
});

const word = (name, gloss = '義') => ({ name, explanationItems: [{ chineseExplanation: gloss }] });
const apiError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

const searchFor = async (keyword) => {
  fireEvent.change(await screen.findByLabelText('查詢關鍵字'), { target: { value: keyword } });
  fireEvent.keyDown(screen.getByLabelText('查詢關鍵字'), { key: 'Enter' });
};

describe('FE3-01：查詢失敗依原因分開說明', () => {
  // 用大括號：beforeEach 回傳函式會被 vitest 當成清理函式呼叫
  beforeEach(() => { apiPost.mockReset(); });

  test('訪客被限流（429）：說明請稍後再試、登入後額度較多，可以重試', async () => {
    apiPost.mockRejectedValue(apiError(429));
    render(<SearchPage />);
    const alert = await screen.findByText(/查詢次數太多，請稍候約一分鐘再試/);
    expect(alert).toHaveTextContent('登入後可以查更多次');
    expect(screen.getByRole('button', { name: '重試' })).toBeInTheDocument();
  });

  test('服務掛了（503／斷線）：服務暫時無法使用，不是「查無結果」', async () => {
    apiPost.mockRejectedValue(apiError(503));
    render(<SearchPage />);
    expect(await screen.findByText('辭典服務暫時無法使用，請稍後再試。')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /找不到/ })).not.toBeInTheDocument();
  });

  test('登入過期（401）：給重新登入的連結，不給沒用的重試', async () => {
    apiPost.mockRejectedValue(apiError(401));
    render(<SearchPage />);
    expect(await screen.findByRole('link', { name: '重新登入' })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('button', { name: '重試' })).not.toBeInTheDocument();
  });

  test('查無結果仍是空狀態，不是錯誤', async () => {
    apiPost.mockImplementation((url, body) => Promise.resolve(body.keyword
      ? { exact_match_results: [], fuzzy_match_results: {} }
      : { all_results: { 0: [word('balay')] }, total: 1 }));
    render(<SearchPage />);
    await screen.findByText('balay');
    await searchFor('zzzz');
    expect(await screen.findByRole('heading', { name: '找不到「zzzz」' })).toBeInTheDocument();
    expect(screen.queryByText(/辭典服務暫時無法使用/)).not.toBeInTheDocument();
  });
});

test('FE3-02：送出前整理空白與 NFC，但不改大小寫與撇號（顯示保留原字）', async () => {
  apiPost.mockReset();
  apiPost.mockResolvedValue({ exact_match_results: [], fuzzy_match_results: {} });
  render(<SearchPage />);
  await searchFor('  ’Café　');
  await waitFor(() => expect(apiPost).toHaveBeenCalledWith(expect.anything(), { keyword: '’Café', tribe: '泰雅' }));
});

test('FE3-05：發音 hook 不再拿到查詢的 setError（例句發音失敗不寫進主錯誤框）', async () => {
  apiPost.mockReset();
  apiPost.mockResolvedValue({ all_results: {}, total: 0 });
  render(<SearchPage />);
  await waitFor(() => expect(apiPost).toHaveBeenCalled());
  for (const args of useAudioPlayback.mock.calls) expect(args).toHaveLength(1);
});

test('FE3-13：瀏覽全部詞條時換篩選，保留舊結果並淡化，不在上方插骨架', async () => {
  apiPost.mockReset();
  apiPost.mockResolvedValueOnce({ all_results: { 0: [word('balay')], 1: [word('cyux')] }, total: 2, available_letters: ['b', 'c'] });
  render(<SearchPage />);
  await screen.findByText('balay');
  apiPost.mockImplementation(() => new Promise(() => {})); // 新的篩選結果還沒回來
  fireEvent.click(screen.getByRole('button', { name: /進階篩選/ }));
  fireEvent.click(screen.getByRole('button', { name: 'c' }));
  await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('搜尋中…')).not.toBeInTheDocument();
  expect(screen.getByText('balay')).toBeInTheDocument();
  expect(document.querySelector('.search-results-main')).toHaveAttribute('aria-busy', 'true');
});

test('FE3-15：詳情裡換到下一個詞再關閉，焦點回到那個詞的字卡', async () => {
  apiPost.mockReset();
  apiPost.mockResolvedValue({ all_results: { 0: [word('balay', '真的')], 1: [word('cyux', '看')] }, total: 2 });
  render(<SearchPage />);
  fireEvent.click(await screen.findByRole('button', { name: /^balay/ }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: /下一個/ }));
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveAccessibleName('cyux'));
  fireEvent.click(screen.getByRole('button', { name: '關閉詳情' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^cyux/ })));
});
