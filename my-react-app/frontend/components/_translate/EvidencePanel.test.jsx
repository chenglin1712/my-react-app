import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import EvidencePanel from './EvidencePanel';
import { apiPost } from '../../utils/apiClient';

vi.mock('../../utils/apiClient', () => ({ apiPost: vi.fn() }));

const analysis = (over = {}) => ({
  tribe: '噶瑪蘭語', tribeSlug: 'kavalan', input: 'lemintun', normalized: 'lemintun',
  token: { status: 'unknown', wordIds: [] },
  candidates: [{
    source: 'rule', confidence: 'high', root: 'lintun', rootWordIds: ['w'], gloss: '榕樹',
    segments: [{ text: 'l', kind: 'root' }, { text: 'em', kind: 'affix' }, { text: 'intun', kind: 'root' }],
    rule: { marker: '-em-', kind: 'I', function: null }, examples: [],
  }],
  rulesAvailable: true, admittedRuleCount: 3, notes: [], ...over,
});

const derived = { surface: 'lemintun', status: 'derived', lemma: 'lintun', gloss: '榕樹', note: '依形態規則推定：-em-' };

describe('EvidencePanel 的詞形分析', () => {
  beforeEach(() => {
    // 用大括號、不要回傳值：回傳 mock 函式本身的話，vitest 會把它當成清理函式在每個測試後呼叫。
    apiPost.mockReset();
  });

  test('原本的內容不變：有佐證的詞照舊顯示詞條、釋義與詞綴分析說明', () => {
    render(<EvidencePanel token={derived} onPlayAudio={vi.fn()} />);
    expect(screen.getByText('詞綴變化形')).toBeInTheDocument();
    expect(screen.getByText(/榕樹/)).toBeInTheDocument();
    expect(screen.getByText('詞綴分析：依形態規則推定：-em-')).toBeInTheDocument();
  });

  test('沒有傳 tribeSlug（舊的呼叫方式）就不顯示詞形分析按鈕', () => {
    render(<EvidencePanel token={derived} onPlayAudio={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /詞形分析/ })).not.toBeInTheDocument();
  });

  test('沒有 token 時整個面板不顯示', () => {
    const { container } = render(<EvidencePanel token={null} tribeSlug="kavalan" />);
    expect(container).toBeEmptyDOMElement();
  });

  test('不會一打開面板就自動打 API，要使用者按了才分析', () => {
    render(<EvidencePanel token={derived} onPlayAudio={vi.fn()} tribeSlug="kavalan" />);
    expect(screen.getByRole('button', { name: /詞形分析/ })).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  test('按下去用這個詞的原樣拼寫與翻譯結果的族語分析，並顯示切分與信心', async () => {
    apiPost.mockResolvedValue(analysis());
    render(<EvidencePanel token={derived} onPlayAudio={vi.fn()} tribeSlug="kavalan" />);
    fireEvent.click(screen.getByRole('button', { name: /詞形分析/ }));

    expect(await screen.findByText('高信心')).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledWith(expect.stringContaining('/morphology/analyze'), { tribe: 'kavalan', word: 'lemintun' }, expect.any(Object));
    expect(screen.getAllByTitle(/^(詞根|詞綴)$/).map((s) => s.textContent)).toEqual(['l', 'em', 'intun']);
    // 分析結果出來之後按鈕就不再顯示
    expect(screen.queryByRole('button', { name: /詞形分析：看詞根與詞綴/ })).not.toBeInTheDocument();
  });

  test('沒有佐證的詞（unsupported）也能查，結果仍會附「不代表存在」的聲明', async () => {
    apiPost.mockResolvedValue(analysis({ candidates: [], notes: ['辭典裡沒有這個詞形，也找不到可信的分析結果。'] }));
    render(<EvidencePanel token={{ surface: 'zzzz', status: 'unsupported' }} onPlayAudio={vi.fn()} tribeSlug="kavalan" />);
    fireEvent.click(screen.getByRole('button', { name: /詞形分析/ }));
    expect(await screen.findByText(/不代表它在族語裡真的存在/)).toBeInTheDocument();
  });

  test('分析失敗時顯示錯誤訊息，按鈕保留讓使用者可以再試', async () => {
    apiPost.mockRejectedValue(new Error('詞形分析暫時無法使用，請稍後再試'));
    render(<EvidencePanel token={derived} onPlayAudio={vi.fn()} tribeSlug="kavalan" />);
    fireEvent.click(screen.getByRole('button', { name: /詞形分析/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('詞形分析暫時無法使用');
    expect(screen.getByRole('button', { name: /詞形分析/ })).toBeInTheDocument();
  });

  test('換一個詞就清掉上一個詞的分析結果', async () => {
    apiPost.mockResolvedValue(analysis());
    const { rerender } = render(<EvidencePanel token={derived} onPlayAudio={vi.fn()} tribeSlug="kavalan" />);
    fireEvent.click(screen.getByRole('button', { name: /詞形分析/ }));
    await screen.findByText('高信心');

    rerender(<EvidencePanel token={{ surface: 'other', status: 'headword', lemma: 'other' }} onPlayAudio={vi.fn()} tribeSlug="kavalan" />);
    await waitFor(() => expect(screen.queryByText('高信心')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /詞形分析/ })).toBeInTheDocument();
  });

  test('分析中按鈕停用，避免重複送出', async () => {
    apiPost.mockReturnValue(new Promise(() => {}));
    render(<EvidencePanel token={derived} onPlayAudio={vi.fn()} tribeSlug="kavalan" />);
    fireEvent.click(screen.getByRole('button', { name: /詞形分析/ }));
    const busy = await screen.findByRole('button', { name: '分析中…' });
    expect(busy).toBeDisabled();
  });
});
