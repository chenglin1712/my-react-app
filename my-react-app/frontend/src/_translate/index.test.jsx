import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { MemoryRouter } from 'react-router-dom';

import TranslatePage from './index';
import { apiGet, apiPost, trackEvent } from '../../utils/apiClient';

const authState = vi.hoisted(() => ({ current: { userData: { uid: 'u1' }, loading: false } }));
vi.mock('../userServives/authContext', () => ({ useAuth: () => authState.current }));

vi.mock('../../utils/apiClient', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  trackEvent: vi.fn(),
}));
vi.mock('../../hooks/useAudioPlayback', () => ({
  default: () => ({ playAudio: vi.fn(), playSentence: vi.fn() }),
}));

function renderPage() {
  return render(<MemoryRouter><TranslatePage /></MemoryRouter>);
}

function typeAndSubmit(text) {
  const textarea = screen.getByPlaceholderText(/輸入要翻譯的中文句子/);
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '翻譯' }));
}

describe('TranslatePage（回歸測試：swap/切族語都要能取消還在跑的舊翻譯請求）', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    trackEvent.mockReset();
    apiGet.mockResolvedValue({ tribes: [] });
  });

  test('交換方向時，還在跑的舊翻譯請求不會在回來後把結果顯示成新方向的翻譯', async () => {
    let resolveFirst;
    apiPost.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));

    renderPage();
    typeAndSubmit('你好');

    fireEvent.click(screen.getByRole('button', { name: '交換翻譯方向' }));

    // 舊請求這時候才回來——不該再更新畫面（沒有跑到「翻譯結果會顯示在這裡」之外的狀態）
    resolveFirst({ translation: '舊結果', tokens: [], coverage: { total: 0 }, evidence: { sentences: [] } });
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText('舊結果')).not.toBeInTheDocument();
  });

  test('切換族語時會取消還在跑的舊翻譯請求，並清空目前顯示的結果', async () => {
    let resolveFirst;
    apiPost.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));

    renderPage();
    typeAndSubmit('你好');

    // 切到另一個族語
    fireEvent.click(screen.getByText('阿美族語'));

    resolveFirst({ translation: '舊族語結果', tokens: [], coverage: { total: 0 }, evidence: { sentences: [] } });
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText('舊族語結果')).not.toBeInTheDocument();
    expect(screen.getByText('翻譯結果會顯示在這裡')).toBeInTheDocument();
  });

  test('正常送出翻譯，結果會顯示出來', async () => {
    apiPost.mockResolvedValueOnce({
      translation: '你好', tokens: [{ surface: '你', status: 'headword' }],
      coverage: { total: 1 }, evidence: { sentences: [] },
    });

    renderPage();
    typeAndSubmit('hello');

    await waitFor(() => expect(screen.getByText('你')).toBeInTheDocument());
    // 公開事件端點不收 translate_submit（固定 400）；使用紀錄由後端翻譯成功時自己寫
    expect(trackEvent).not.toHaveBeenCalled();
  });
});

describe('TranslatePage 的交換方向與文字（E-3）', () => {
  beforeEach(() => {
    authState.current = { userData: { uid: 'u1' }, loading: false };
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockResolvedValue({ tribes: [] });
  });

  test('還沒有結果就交換方向：輸入框保留原文，並明講方向已切換、請確認內容', () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/輸入要翻譯的中文句子/), { target: { value: '你好' } });
    fireEvent.click(screen.getByRole('button', { name: '交換翻譯方向' }));

    expect(screen.getByRole('status')).toHaveTextContent('方向已切換為「族語 → 繁體中文」');
    expect(screen.getByLabelText('輸入族語原文')).toHaveValue('你好');
    // 一改輸入內容，提示就收掉
    fireEvent.change(screen.getByLabelText('輸入族語原文'), { target: { value: 'blaq' } });
    expect(screen.queryByText(/方向已切換為/)).not.toBeInTheDocument();
  });

  test('有結果時交換方向：翻譯結果放進輸入框並說明', async () => {
    apiPost.mockResolvedValueOnce({
      translation: 'blaq', tokens: [{ surface: 'blaq', status: 'headword' }],
      coverage: { total: 1 }, evidence: { sentences: [] },
    });
    renderPage();
    typeAndSubmit('好');
    await screen.findByText('blaq');
    fireEvent.click(screen.getByRole('button', { name: '交換翻譯方向' }));

    expect(screen.getByLabelText('輸入族語原文')).toHaveValue('blaq');
    expect(screen.getByRole('status')).toHaveTextContent('已把剛才的翻譯結果放進輸入框');
  });

  test('佐證數顯示真正有佐證的詞數（總數扣掉查無佐證）', async () => {
    apiPost.mockResolvedValueOnce({
      translation: 'a b c', tokens: [{ surface: 'a', status: 'headword' }],
      coverage: { total: 3, unsupported: 0 }, evidence: { sentences: [] },
    });
    renderPage();
    typeAndSubmit('好');
    expect(await screen.findByText('3/3 個詞有辭典語料佐證')).toBeInTheDocument();
  });

  test('輸入框有 Ctrl + Enter 送出的提示', () => {
    renderPage();
    expect(screen.getByText(/也可以送出/)).toBeInTheDocument();
    expect(screen.getByLabelText('輸入繁體中文原文')).toHaveAccessibleDescription(/也可以送出/);
  });

  test('沒有 navigator.clipboard 時，複製改用備用方式', async () => {
    apiPost.mockResolvedValueOnce({
      translation: 'blaq', tokens: [{ surface: 'blaq', status: 'headword' }],
      coverage: { total: 1 }, evidence: { sentences: [] },
    });
    const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = vi.fn(() => true);
    try {
      renderPage();
      typeAndSubmit('好');
      await screen.findByText('blaq');
      fireEvent.click(screen.getByRole('button', { name: /複製/ }));
      expect(document.execCommand).toHaveBeenCalledWith('copy');
      expect(await screen.findByText(/已複製/)).toBeInTheDocument();
    } finally {
      if (original) Object.defineProperty(globalThis.navigator, 'clipboard', original);
      else delete globalThis.navigator.clipboard;
    }
  });
});

describe('TranslatePage 的依據面板：詞形分析', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    trackEvent.mockReset();
    apiGet.mockResolvedValue({ tribes: [] });
  });

  test('點開一個詞的依據後，可以按「詞形分析」，且用的是這次翻譯的族語', async () => {
    apiPost.mockImplementation((url) => (
      String(url).includes('/morphology/')
        ? Promise.resolve({
          tribe: '泰雅語', tribeSlug: 'tayal', input: 'blaq', normalized: 'blaq',
          token: { status: 'headword', gloss: '好', wordIds: ['w'] }, candidates: [], rulesAvailable: true,
          admittedRuleCount: 0, notes: [],
        })
        : Promise.resolve({
          tribeSlug: 'tayal', translation: 'blaq', coverage: { total: 1 }, evidence: { sentences: [] },
          tokens: [{ surface: 'blaq', status: 'headword', lemma: 'blaq', gloss: '好' }],
        })
    ));

    renderPage();
    typeAndSubmit('好');
    fireEvent.click(await screen.findByText('blaq'));

    fireEvent.click(await screen.findByRole('button', { name: /詞形分析/ }));

    await waitFor(() => expect(screen.getByText('辭典詞條', { selector: 'span.yy-morph-status' })).toBeInTheDocument());
    const call = apiPost.mock.calls.find(([url]) => String(url).includes('/morphology/'));
    expect(call[1]).toEqual({ tribe: 'tayal', word: 'blaq' });
  });
});

describe('TranslatePage 的訪客試用（C-3）', () => {
  const okResult = (remaining) => ({
    translation: '你好', tribeSlug: 'tayal', coverage: { total: 1 }, evidence: { sentences: [] },
    tokens: [{ surface: 'blaq', status: 'headword', lemma: 'blaq', gloss: '好', audioFileId: 'a1' }],
    guestQuota: { limit: 10, remaining, resetsAt: '2026-10-15T00:00:00+08:00' },
  });
  const mockQuota = (quota) => {
    apiGet.mockImplementation((url) => (
      String(url).includes('guest-quota') ? quota() : Promise.resolve({ tribes: [] })
    ));
  };

  beforeEach(() => {
    authState.current = { userData: null, loading: false };
    apiGet.mockReset();
    apiPost.mockReset();
    trackEvent.mockReset();
  });

  test('訪客會看到今天剩餘次數，且查詢額度時標示為訪客請求', async () => {
    mockQuota(() => Promise.resolve({ isGuest: true, limit: 10, remaining: 7, resetsAt: 'x' }));
    renderPage();

    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(screen.getByText(/今天還能翻譯/)).toBeInTheDocument();
    const call = apiGet.mock.calls.find(([url]) => String(url).includes('guest-quota'));
    expect(call[1]).toMatchObject({ guest: true });
    expect(screen.getByText('試用會記錄什麼？')).toBeInTheDocument();
  });

  test('訪客送出翻譯會標示 guest，成功後剩餘次數依回應更新', async () => {
    mockQuota(() => Promise.resolve({ isGuest: true, limit: 10, remaining: 7, resetsAt: 'x' }));
    apiPost.mockResolvedValueOnce(okResult(6));
    renderPage();
    await screen.findByText('7');

    typeAndSubmit('好');

    expect(await screen.findByText('6')).toBeInTheDocument();
    expect(apiPost.mock.calls[0][2]).toMatchObject({ guest: true });
  });

  test('次數用完（429 guest_quota_exhausted）：出現免費註冊與登入，送出鈕停用，不顯示紅色錯誤', async () => {
    mockQuota(() => Promise.resolve({ isGuest: true, limit: 10, remaining: 1, resetsAt: 'x' }));
    apiPost.mockRejectedValueOnce(Object.assign(new Error('今天的免費試用次數已用完'), {
      status: 429, data: { code: 'guest_quota_exhausted', limit: 10, detail: '今天的免費試用次數已用完' },
    }));
    renderPage();
    await screen.findByText('1');

    typeAndSubmit('好');

    expect(await screen.findByText('今天的免費試用次數用完了')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '免費註冊' })).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: '登入' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('button', { name: '翻譯' })).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('這個網路的上限用完（429 guest_ip_capped）：顯示網路層級的說明', async () => {
    mockQuota(() => Promise.resolve({ isGuest: true, limit: 10, remaining: 5, resetsAt: 'x' }));
    apiPost.mockRejectedValueOnce(Object.assign(new Error('x'), {
      status: 429, data: { code: 'guest_ip_capped', limit: 10 },
    }));
    renderPage();
    await screen.findByText('5');

    typeAndSubmit('好');

    expect(await screen.findByText('這個網路今天的試用次數已達上限')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '免費註冊' })).toBeInTheDocument();
  });

  test('開頁時額度就是 0：直接顯示用完的畫面，不能送出', async () => {
    mockQuota(() => Promise.resolve({ isGuest: true, limit: 10, remaining: 0, resetsAt: 'x' }));
    renderPage();

    expect(await screen.findByText('今天的免費試用次數用完了')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '翻譯' })).toBeDisabled();
  });

  test('後端沒開放訪客試用（額度查詢回 401）：維持「請先登入」畫面', async () => {
    mockQuota(() => Promise.reject(Object.assign(new Error('請先登入'), { status: 401 })));
    renderPage();

    expect(await screen.findByText(/請先登入才可使用/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '翻譯' })).not.toBeInTheDocument();
  });

  test('查不到剩餘次數（伺服器暫時有問題）：說明原因，仍可嘗試翻譯', async () => {
    mockQuota(() => Promise.reject(Object.assign(new Error('boom'), { status: 500 })));
    renderPage();

    expect(await screen.findByText(/暫時無法確認今天還剩幾次/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/輸入要翻譯的中文句子/), { target: { value: '好' } });
    expect(screen.getByRole('button', { name: '翻譯' })).toBeEnabled();
  });

  test('訪客點逐詞發音：說明需要登入，不送出發音請求', async () => {
    mockQuota(() => Promise.resolve({ isGuest: true, limit: 10, remaining: 7, resetsAt: 'x' }));
    apiPost.mockResolvedValueOnce(okResult(6));
    renderPage();
    await screen.findByText('7');
    typeAndSubmit('好');
    fireEvent.click(await screen.findByRole('button', { name: /逐詞發音/ }));

    expect(screen.getByText(/發音與詞形分析需要登入/)).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  test('已登入：不查額度、不顯示試用提示，翻譯請求不標示 guest', async () => {
    authState.current = { userData: { uid: 'u1' }, loading: false };
    apiGet.mockResolvedValue({ tribes: [] });
    apiPost.mockResolvedValueOnce(okResult(0));
    renderPage();
    typeAndSubmit('好');

    await screen.findByText('blaq');
    expect(apiGet.mock.calls.some(([url]) => String(url).includes('guest-quota'))).toBe(false);
    expect(screen.queryByText('試用會記錄什麼？')).not.toBeInTheDocument();
    expect(apiPost.mock.calls[0][2]).toMatchObject({ guest: false });
  });

  test('登出時清掉已登入者的輸入與翻譯結果', async () => {
    authState.current = { userData: { uid: 'u1' }, loading: false };
    apiGet.mockImplementation((url) => (
      String(url).includes('guest-quota')
        ? Promise.resolve({ isGuest: true, limit: 10, remaining: 7, resetsAt: 'x' })
        : Promise.resolve({ tribes: [] })
    ));
    apiPost.mockResolvedValueOnce(okResult(0));
    const view = renderPage();
    typeAndSubmit('機密句子');
    await screen.findByText('blaq');

    authState.current = { userData: null, loading: false };
    view.rerender(<MemoryRouter><TranslatePage /></MemoryRouter>);

    await waitFor(() => expect(screen.queryByText('blaq')).not.toBeInTheDocument());
    expect(screen.getByPlaceholderText(/輸入要翻譯的中文句子/)).toHaveValue('');
  });
});
