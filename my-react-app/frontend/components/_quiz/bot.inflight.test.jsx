import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AIAssistantOverlay from './bot';
import BotReplyActions from './BotReplyActions';
import { apiGet, apiPost } from '../../utils/apiClient';
import { STORAGE_PREFIX } from './botStorage';

const auth = vi.hoisted(() => ({ listener: null }));
vi.mock('../../utils/apiClient', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiStream: vi.fn() }));
vi.mock('./bot_study_plan', () => ({ default: () => null }));
vi.mock('../../hooks/useAuthorizedAudioPlayback', () => ({
  default: () => ({ playAudio: vi.fn(), failedAudio: new Set() }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@utils/announce', () => ({ announce: vi.fn() }));
vi.mock('../../../firebase', () => ({ auth: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth, cb) => { auth.listener = cb; cb({ uid: 'a' }); return () => { auth.listener = null; }; },
}));

const reply = (message) => ({ message, sig: 'e'.repeat(64) });
const ask = (user, text) => user.type(screen.getByLabelText('輸入訊息'), `${text}{Enter}`);
const BUSY = 'AI 服務目前忙碌，請稍後再試';
const busy = () => Object.assign(new Error('x'), { status: 503, data: { detail: BUSY } });

describe('in-flight work and history', () => {
  beforeEach(() => {
    localStorage.clear();
    apiGet.mockReset(); apiPost.mockReset();
    apiGet.mockResolvedValue({ remaining: 50, resetsAt: null, features: {} });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  test('an answer that arrives after an account switch is not shown or saved for the new account', async () => {
    let resolvePost;
    apiPost.mockImplementation(() => new Promise((resolve) => { resolvePost = resolve; }));   // 故意無視 abort signal
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    await screen.findByLabelText('輸入訊息');
    await ask(user, 'A 的問題');
    await waitFor(() => expect(apiPost).toHaveBeenCalled());

    act(() => auth.listener({ uid: 'b' }));
    await act(async () => { resolvePost(reply('A 的遲到回覆')); });
    expect(screen.queryByText('A 的遲到回覆')).not.toBeInTheDocument();
    expect(localStorage.getItem(`${STORAGE_PREFIX}b`)).toBeNull();
    expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument();   // 不再卡在等待狀態
  });

  test('an open "new conversation" confirmation does not survive a switch and cannot delete the new account', async () => {
    localStorage.setItem(`${STORAGE_PREFIX}b`, JSON.stringify({
      savedAt: Date.now(), tribe: 'tayal',
      messages: [{ id: '1', role: 'user', text: 'B 的問題' }, { id: '2', role: 'bot', text: 'B 的回覆', sig: 'e'.repeat(64) }],
    }));
    apiPost.mockResolvedValueOnce(reply('A 的回覆'));
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    await screen.findByLabelText('輸入訊息');
    await ask(user, 'A 的問題');
    await screen.findByText('A 的回覆');
    await user.click(screen.getByRole('button', { name: '新對話' }));
    expect(screen.getByText(/無法復原/)).toBeInTheDocument();

    act(() => auth.listener({ uid: 'b' }));
    await screen.findByText('B 的回覆');
    expect(screen.queryByText(/無法復原/)).not.toBeInTheDocument();
    expect(localStorage.getItem(`${STORAGE_PREFIX}b`)).not.toBeNull();
  });

  test('retrying the later question keeps the earlier question\'s failure in the history', async () => {
    apiPost.mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy()).mockResolvedValueOnce(reply('第二題好了'));
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    await screen.findByLabelText('輸入訊息');
    await ask(user, '第一題');
    expect(await screen.findAllByText(BUSY)).toHaveLength(1);
    await ask(user, '第二題');
    await waitFor(() => expect(screen.getAllByText(BUSY)).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByText('第二題好了')).toBeInTheDocument();
    expect(screen.getAllByText(BUSY)).toHaveLength(1);
  });
});

describe('BotReplyActions overlapping copies', () => {
  test('a stale failure that finishes after a newer success does not overwrite it', async () => {
    const pending = [];
    const writeText = vi.fn(() => new Promise((resolve, reject) => { pending.push({ resolve, reject }); }));
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<BotReplyActions text="內容" canRegenerate={false} onRegenerate={vi.fn()} />);
    await user.dblClick(screen.getByRole('button', { name: '複製回覆' }));
    await act(async () => { pending[1].resolve(); });
    expect(await screen.findByRole('button', { name: '已複製' })).toBeInTheDocument();
    await act(async () => { pending[0].reject(new Error('late')); });
    expect(screen.getByRole('button', { name: '已複製' })).toBeInTheDocument();
  });
});
