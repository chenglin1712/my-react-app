import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import TranslatePage from './index';
import { apiGet, apiPost, trackEvent } from '../../utils/apiClient';

vi.mock('../../utils/apiClient', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  trackEvent: vi.fn(),
}));
vi.mock('../../hooks/useAudioPlayback', () => ({
  default: () => ({ playAudio: vi.fn(), playSentence: vi.fn() }),
}));

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

    render(<TranslatePage />);
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

    render(<TranslatePage />);
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

    render(<TranslatePage />);
    typeAndSubmit('hello');

    await waitFor(() => expect(screen.getByText('你')).toBeInTheDocument());
  });
});
