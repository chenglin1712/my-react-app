import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AIAssistantOverlay from './bot';
import { apiGet, apiPost } from '../../utils/apiClient';
import { STORAGE_PREFIX } from './botStorage';

vi.mock('../../utils/apiClient', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiStream: vi.fn() }));
vi.mock('./bot_study_plan', () => ({ default: () => null }));
vi.mock('../../hooks/useAuthorizedAudioPlayback', () => ({
  default: () => ({ playAudio: vi.fn(), failedAudio: new Set() }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@utils/announce', () => ({ announce: vi.fn() }));
vi.mock('../../../firebase', () => ({ auth: { currentUser: { uid: 'u1' } } }));

const SIG = 'c'.repeat(64);
const reply = (message, sig = SIG) => ({ message, sig });
const ask = async (user, text) => {
  await user.type(screen.getByLabelText('輸入訊息'), `${text}{Enter}`);
};
const savedKey = `${STORAGE_PREFIX}u1`;

describe('AI chat conversation controls', () => {
  beforeEach(() => {
    localStorage.clear();
    apiGet.mockReset(); apiPost.mockReset();
    apiGet.mockResolvedValue({ remaining: 50, resetsAt: null, features: {} });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  test('a retryable failure keeps the question, offers retry, and retry does not duplicate it', async () => {
    apiPost.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 503, data: { detail: 'AI 服務目前忙碌，請稍後再試' } }));
    apiPost.mockResolvedValueOnce(reply('好了'));
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    await ask(user, 'lokah 是什麼');
    expect(await screen.findByText('AI 服務目前忙碌，請稍後再試')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByText('好了')).toBeInTheDocument();
    expect(screen.getAllByText('lokah 是什麼')).toHaveLength(1);
    expect(screen.queryByText('AI 服務目前忙碌，請稍後再試')).not.toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledTimes(2);
    expect(apiPost.mock.calls[1][1].message).toBe('lokah 是什麼');
  });

  test('regenerate replaces the last reply and does not send the rejected answer as history', async () => {
    apiPost.mockResolvedValueOnce(reply('第一版'));
    apiPost.mockResolvedValueOnce(reply('第二版', 'd'.repeat(64)));
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    await ask(user, '問題');
    await screen.findByText('第一版');

    await user.click(screen.getByRole('button', { name: '重新產生回覆' }));
    expect(await screen.findByText('第二版')).toBeInTheDocument();
    expect(screen.queryByText('第一版')).not.toBeInTheDocument();
    expect(screen.getAllByText('問題')).toHaveLength(1);
    expect(apiPost.mock.calls[1][1].history).toEqual([]);          // 上一輪（被重新產生的那輪）不進對話記憶
    expect(screen.getAllByRole('button', { name: '重新產生回覆' })).toHaveLength(1);
  });

  test('only the last reply can be regenerated; copy puts the reply text on the clipboard', async () => {
    apiPost.mockResolvedValueOnce(reply('答一'));
    apiPost.mockResolvedValueOnce(reply('答二', 'd'.repeat(64)));
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    await ask(user, '一'); await screen.findByText('答一');
    await ask(user, '二'); await screen.findByText('答二');
    expect(screen.getAllByRole('button', { name: '複製回覆' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: '重新產生回覆' })).toHaveLength(1);

    await user.click(screen.getAllByRole('button', { name: '複製回覆' })[1]);
    expect(await navigator.clipboard.readText()).toBe('答二');      // user-event 提供的剪貼簿
    expect(await screen.findByRole('button', { name: '已複製' })).toBeInTheDocument();
  });

  test('the stop button appears while waiting even without streaming, and stopping adds nothing more', async () => {
    let capturedSignal;
    apiPost.mockImplementation((_u, _d, options) => new Promise((_resolve, reject) => {
      capturedSignal = options.signal;
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'CanceledError' })));
    }));
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    await ask(user, '很慢的問題');
    await user.click(await screen.findByRole('button', { name: '停止' }));
    expect(capturedSignal.aborted).toBe(true);
    expect(await screen.findByText('已停止回覆。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '發送' })).toBeInTheDocument();
  });

  test('the conversation is saved on this device and restored after a reload', async () => {
    apiPost.mockResolvedValueOnce(reply('我記得'));
    const user = userEvent.setup();
    const first = render(<AIAssistantOverlay onClose={vi.fn()} />);
    await ask(user, '請記住這句');
    await screen.findByText('我記得');
    await waitFor(() => expect(localStorage.getItem(savedKey)).toContain('我記得'));
    first.unmount();

    render(<AIAssistantOverlay onClose={vi.fn()} />);
    expect(await screen.findByText('我記得')).toBeInTheDocument();
    expect(screen.getByText('請記住這句')).toBeInTheDocument();
    expect(screen.getByText(/暫存在這台裝置的瀏覽器 7 天/)).toBeInTheDocument();
  });

  test('new conversation asks first, then deletes the saved copy for good', async () => {
    apiPost.mockResolvedValueOnce(reply('舊的回覆'));
    const user = userEvent.setup();
    const first = render(<AIAssistantOverlay onClose={vi.fn()} />);
    await ask(user, '舊的問題'); await screen.findByText('舊的回覆');
    await waitFor(() => expect(localStorage.getItem(savedKey)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: '新對話' }));
    expect(screen.getByText(/無法復原/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByText('舊的回覆')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '新對話' }));
    await user.click(screen.getByRole('button', { name: '刪除並開始新對話' }));
    expect(screen.queryByText('舊的回覆')).not.toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem(savedKey)).toBeNull());
    first.unmount();

    render(<AIAssistantOverlay onClose={vi.fn()} />);
    await screen.findByText(/暫存在這台裝置/);
    expect(screen.queryByText('舊的回覆')).not.toBeInTheDocument();     // 重新整理後也不會回來
  });
});
