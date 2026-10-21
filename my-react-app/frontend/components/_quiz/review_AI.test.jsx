import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewAIAssistant from './review_AI';
import { apiPost } from '../../utils/apiClient';

vi.mock('../../utils/apiClient', () => ({ apiPost: vi.fn() }));

const playAudioMock = vi.hoisted(() => vi.fn());
const failedAudioMock = vi.hoisted(() => ({ current: new Set() }));
vi.mock('../../hooks/useAuthorizedAudioPlayback', () => ({
  default: () => ({ playAudio: playAudioMock, failedAudio: failedAudioMock.current }),
}));

const REPLY = {
  original: 'lokah su',
  translation: '你好',
  words: [{ tayal: 'lokah', chinese: '好' }],
  image: null,
};

describe('ReviewAIAssistant 無障礙（審查項 P1-5、P1-6）', () => {
  beforeEach(() => {
    apiPost.mockReset();
  });

  test('對話紀錄是 role=log，回覆等待中有「助手正在輸入」文字', async () => {
    let resolveApiPost;
    apiPost.mockImplementation(() => new Promise((resolve) => { resolveApiPost = resolve; }));
    const user = userEvent.setup();
    render(<ReviewAIAssistant tribe="tayal" />);

    const log = screen.getByRole('log', { name: '對話紀錄' });
    await user.type(screen.getByLabelText('輸入問題'), '你好{Enter}');
    expect(log).toHaveTextContent('助手正在輸入');
    // 等待中再送一次不會發出第二個請求，輸入框與按鈕也沒有被 disabled
    await user.type(screen.getByLabelText('輸入問題'), '再問{Enter}');
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('輸入問題')).not.toBeDisabled();
    resolveApiPost(REPLY);
    expect(await screen.findByText('lokah su')).toBeInTheDocument();
  });

  test('用鍵盤（Enter）可以放大訊息；放大視窗是 dialog，Esc 關閉並把焦點還給訊息', async () => {
    const user = userEvent.setup();
    render(<ReviewAIAssistant tribe="tayal" />);

    const message = screen.getAllByRole('button', { name: /哈囉/ })[0];
    message.focus();
    await user.keyboard('{Enter}');

    const dialog = screen.getByRole('dialog', { name: '放大檢視訊息' });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(message).toHaveFocus();
  });

  test('組字中的 Enter（注音選字）不會送出', async () => {
    const user = userEvent.setup();
    render(<ReviewAIAssistant tribe="tayal" />);
    await user.type(screen.getByLabelText('輸入問題'), '你好');
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.keyDown(screen.getByLabelText('輸入問題'), { key: 'Enter', isComposing: true });
    expect(apiPost).not.toHaveBeenCalled();
  });
});

describe('ReviewAIAssistant 送出鈕狀態', () => {
  test('空輸入時 aria-disabled 為 true，有內容後變 false', async () => {
    const user = userEvent.setup();
    render(<ReviewAIAssistant tribe="tayal" />);
    const send = screen.getByRole('button', { name: '傳送訊息' });
    expect(send).toHaveAttribute('aria-disabled', 'true');
    await user.type(screen.getByLabelText('輸入問題'), '嗨');
    expect(send).toHaveAttribute('aria-disabled', 'false');
  });

  test('Space 也能開啟放大視窗', async () => {
    const user = userEvent.setup();
    render(<ReviewAIAssistant tribe="tayal" />);
    screen.getAllByRole('button', { name: /哈囉/ })[0].focus();
    await user.keyboard(' ');
    expect(screen.getByRole('dialog', { name: '放大檢視訊息' })).toBeInTheDocument();
  });
});

describe('ReviewAIAssistant 分欄補充說明（路線圖 #11）', () => {
  const SECTIONED = {
    original: 'lokah su',
    translation: '你好嗎',
    sections: {
      vocab: [{ word: 'lokah', note: '問候語' }],
      grammar: '主語放在後面',
      pitfalls: '不要把 su 當成動詞',
    },
    words: [{ tayal: 'lokah', chinese: '你好', audio: 'f1' }, { tayal: 'su', chinese: '你', audio: '' }],
    image: null,
  };

  const ask = async (reply) => {
    apiPost.mockReset();
    playAudioMock.mockReset();
    failedAudioMock.current = new Set();
    apiPost.mockResolvedValue(reply);
    const user = userEvent.setup();
    render(<ReviewAIAssistant tribe="tayal" />);
    await user.type(screen.getByLabelText('輸入問題'), 'lokah su{Enter}');
    await screen.findAllByText('lokah su');
    return user;
  };

  const openLast = async (user) => {
    const messages = screen.getAllByRole('button', { name: /lokah su/ });
    await user.click(messages[messages.length - 1]);
    return screen.getByRole('dialog', { name: '放大檢視訊息' });
  };

  test('翻譯上方標示它是推測；有內容的分欄依序顯示，沒內容的（文化背景）不出現', async () => {
    await ask(SECTIONED);

    expect(screen.getByText('參考翻譯（推測，未經族語專家確認）')).toBeInTheDocument();
    expect(screen.getByText('你好嗎')).toBeInTheDocument();
    const terms = screen.getAllByRole('term').map((el) => el.textContent);
    expect(terms).toEqual(['詞彙用法', '語法', '常見錯誤']);
    expect(screen.queryByText('文化背景')).not.toBeInTheDocument();
    expect(screen.getByText('主語放在後面')).toBeInTheDocument();
  });

  test('完全沒有分欄時不出現空的區塊', async () => {
    await ask({ ...SECTIONED, sections: undefined });

    expect(screen.queryByRole('term')).not.toBeInTheDocument();
    expect(screen.getByText('你好嗎')).toBeInTheDocument();
  });

  test('拒答或產生失敗的固定說明不標成「參考翻譯」', async () => {
    await ask({ original: 'lokah su', translation: '這次沒有產生補充說明，請再試一次。', failed: true, words: [], image: null });

    expect(screen.getByText('這次沒有產生補充說明，請再試一次。')).toBeInTheDocument();
    expect(screen.queryByText(/參考翻譯/)).not.toBeInTheDocument();
  });

  test('縮圖裡不放連結與發音鈕（整則是 role=button，不能巢狀互動元件）', async () => {
    await ask(SECTIONED);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /播放/ })).not.toBeInTheDocument();
  });

  test('放大檢視裡：詞彙用法的詞連到辭典（另開分頁），有音檔的詞有發音鈕', async () => {
    const user = await ask(SECTIONED);

    const dialog = await openLast(user);

    const link = within(dialog).getByRole('link', { name: '在辭典查看「lokah」（另開新分頁）' });
    expect(link).toHaveAttribute('href', '/search?q=lokah&tribe=tayal');
    expect(link).toHaveAttribute('target', '_blank');
    await user.click(within(dialog).getByRole('button', { name: '播放「lokah」的發音' }));
    expect(playAudioMock).toHaveBeenCalledWith('f1');
    expect(within(dialog).queryByRole('button', { name: '播放「su」的發音' })).not.toBeInTheDocument();
  });

  test('放大檢視裡音檔播放失敗過的詞，顯示文字說明而不是讓按鈕憑空消失', async () => {
    const user = await ask(SECTIONED);
    failedAudioMock.current = new Set(['f1']);

    const dialog = await openLast(user);

    expect(within(dialog).getByText('音檔無法播放')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '播放「lokah」的發音' })).not.toBeInTheDocument();
  });
});
