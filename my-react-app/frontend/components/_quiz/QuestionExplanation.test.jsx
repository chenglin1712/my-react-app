import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuestionExplanation from './QuestionExplanation';
import { apiPost } from '../../utils/apiClient';

vi.mock('../../utils/apiClient', () => ({ apiPost: vi.fn() }));

const playAudioMock = vi.hoisted(() => vi.fn());
const failedAudioMock = vi.hoisted(() => ({ current: new Set() }));
vi.mock('../../hooks/useAuthorizedAudioPlayback', () => ({
  default: () => ({ playAudio: playAudioMock, failedAudio: failedAudioMock.current }),
}));

const RESULT = {
  index: 1,
  type: 'true_false',
  is_correct: false,
  user_answer: 'X（不符合）',
  correct_answer: 'O（符合）',
  difference: '你選了X，正解是O，差別在句子描述的動作。',
  sections: { vocab: [{ word: 'lokah', note: '問候語' }], pitfalls: '常把 su 當成動詞' },
  words: [{ tayal: 'lokah', chinese: '你好', audio: 'f1' }, { tayal: 'su', chinese: '你', audio: '' }],
};

const setup = () => render(<QuestionExplanation attemptId="att1" index={1} tribe="tayal" />);

describe('QuestionExplanation（路線圖 #22）', () => {
  beforeEach(() => {
    apiPost.mockReset();
    playAudioMock.mockReset();
    failedAudioMock.current = new Set();
  });

  test('不會自動送出；按下才請助手講解，而且只送作答編號與題號（不送題目內容或答案）', async () => {
    apiPost.mockResolvedValue(RESULT);
    const user = userEvent.setup();
    setup();
    expect(apiPost).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '請助手講解這一題' }));

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost.mock.calls[0][1]).toEqual({ attempt_id: 'att1', index: 1 });
  });

  test('顯示作答與正解、差別說明、分欄與辭典詞條；說明是推測', async () => {
    apiPost.mockResolvedValue(RESULT);
    const user = userEvent.setup();
    setup();
    expect(screen.getByText(/講解是推測，未經族語專家確認/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '請助手講解這一題' }));

    expect(await screen.findByText(/你選了X，正解是O/)).toBeInTheDocument();
    expect(screen.getByText(/你的作答：X（不符合）/)).toBeInTheDocument();
    expect(screen.getByText(/正確答案：O（符合）/)).toBeInTheDocument();
    expect(screen.getByText('常見錯誤')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: '在辭典查看「lokah」（另開新分頁）' });
    expect(link).toHaveAttribute('href', '/search?q=lokah&tribe=tayal');
    expect(screen.getByLabelText('題目裡的辭典詞條')).toHaveTextContent('你好');
  });

  test('有音檔的詞才有發音鈕，按下去用音檔編號播放', async () => {
    apiPost.mockResolvedValue(RESULT);
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: '請助手講解這一題' }));

    await user.click(await screen.findByRole('button', { name: '播放「lokah」的發音' }));

    expect(playAudioMock).toHaveBeenCalledWith('f1');
    expect(screen.queryByRole('button', { name: '播放「su」的發音' })).not.toBeInTheDocument();
  });

  test('整理中不重複送出，按鈕不是 disabled（焦點不會掉走），結果區標示忙碌', async () => {
    let resolve;
    apiPost.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const user = userEvent.setup();
    setup();
    const button = screen.getByRole('button', { name: '請助手講解這一題' });

    await user.click(button);
    const busy = screen.getByRole('button', { name: '助手整理中…' });
    await user.click(busy);

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    resolve(RESULT);
    expect(await screen.findByText(/你選了X/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新講解' })).toBeInTheDocument();
  });

  test.each([
    [{ status: 404 }, '找不到這一題的作答紀錄'],
    [{ status: 429, data: { code: 'ai_daily_quota_exceeded' } }, '今天的提問次數已經用完了'],
    [{ status: 429 }, '請求太頻繁'],
    [{ status: 403, data: { code: 'ai_question_review_disabled' } }, '題目講解目前尚未開放'],
    [{ status: 500, message: 'internal detail' }, '暫時無法產生講解'],
  ])('錯誤依類型顯示說明，不洩漏後端原始訊息：%j', async (error, expected) => {
    apiPost.mockRejectedValue(Object.assign(new Error('internal detail'), error));
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: '請助手講解這一題' }));

    expect(await screen.findByText(new RegExp(expected))).toBeInTheDocument();
    expect(screen.queryByText(/internal detail/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新講解' })).toBeInTheDocument();
  });

  test('拒答或產生失敗的固定說明只顯示說明，不顯示分欄與詞條', async () => {
    apiPost.mockResolvedValue({ ...RESULT, difference: '這次沒有產生講解，請再試一次。', failed: true, sections: undefined, words: [] });
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: '請助手講解這一題' }));

    expect(await screen.findByText('這次沒有產生講解，請再試一次。')).toBeInTheDocument();
    expect(screen.queryByLabelText('題目裡的辭典詞條')).not.toBeInTheDocument();
  });

  test('音檔播放失敗過的詞顯示文字說明，不是憑空消失的按鈕', async () => {
    failedAudioMock.current = new Set(['f1']);
    apiPost.mockResolvedValue(RESULT);
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: '請助手講解這一題' }));

    expect(await screen.findByText('音檔無法播放')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '播放「lokah」的發音' })).not.toBeInTheDocument();
  });

  test('離開這一題（卸載）時中止進行中的請求，之後回來的結果不會更新畫面', async () => {
    let resolve;
    let signal;
    apiPost.mockImplementation((_url, _body, options) => new Promise((r) => { resolve = r; signal = options.signal; }));
    const user = userEvent.setup();
    const { unmount } = setup();
    await user.click(screen.getByRole('button', { name: '請助手講解這一題' }));

    unmount();

    expect(signal.aborted).toBe(true);
    await act(async () => { resolve(RESULT); });     // 過期的回應不應該丟出任何錯誤
  });
});
