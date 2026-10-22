import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AIAssistantOverlay from './bot';
import BotReplyActions from './BotReplyActions';
import { apiGet, apiPost } from '../../utils/apiClient';
import { STORAGE_PREFIX } from './botStorage';
import { prepareChatImage } from './chatImage';

const auth = vi.hoisted(() => ({ listener: null }));
vi.mock('../../utils/apiClient', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiStream: vi.fn() }));
vi.mock('./bot_study_plan', () => ({ default: () => null }));
vi.mock('../../hooks/useAuthorizedAudioPlayback', () => ({
  default: () => ({ playAudio: vi.fn(), failedAudio: new Set() }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@utils/announce', () => ({ announce: vi.fn() }));
// 縮圖需要 canvas，jsdom 沒有
vi.mock('./chatImage', async (importActual) => ({ ...(await importActual()), prepareChatImage: vi.fn() }));
vi.mock('../../../firebase', () => ({ auth: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth, cb) => { auth.listener = cb; cb({ uid: 'a' }); return () => { auth.listener = null; }; },
}));

const reply = (message) => ({ message, sig: 'e'.repeat(64) });

describe('AI chat across accounts and images', () => {
  beforeEach(() => {
    localStorage.clear();
    apiGet.mockReset(); apiPost.mockReset();
    apiGet.mockResolvedValue({ remaining: 50, resetsAt: null, features: {} });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  test('switching account clears the previous conversation and never writes it under the new uid', async () => {
    apiPost.mockResolvedValueOnce(reply('A 的回覆'));
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    await user.type(await screen.findByLabelText('輸入訊息'), 'A 的問題{Enter}');
    await screen.findByText('A 的回覆');
    await waitFor(() => expect(localStorage.getItem(`${STORAGE_PREFIX}a`)).not.toBeNull());

    act(() => auth.listener({ uid: 'b' }));
    await waitFor(() => expect(screen.queryByText('A 的回覆')).not.toBeInTheDocument());
    expect(screen.queryByText('A 的問題')).not.toBeInTheDocument();
    expect(localStorage.getItem(`${STORAGE_PREFIX}b`)).toBeNull();
    expect(localStorage.getItem(`${STORAGE_PREFIX}a`)).not.toBeNull();     // 上一位自己的保存不動

    act(() => auth.listener(null));                                          // 登出
    await waitFor(() => expect(screen.queryByText('A 的回覆')).not.toBeInTheDocument());
  });

  test('a reply to an image question cannot be regenerated', async () => {
    apiGet.mockResolvedValue({ remaining: 50, resetsAt: null, features: { imageInput: true } });
    apiPost.mockResolvedValueOnce(reply('這是圖片的說明'));
    prepareChatImage.mockResolvedValue({ media_type: 'image/jpeg', data: 'QUJD', previewUrl: 'blob:preview-1' });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    await screen.findByRole('button', { name: '拍照或選擇圖片' });
    await user.upload(document.querySelector('input[type="file"]'), new File(['x'], 'card.jpg', { type: 'image/jpeg' }));
    await user.type(screen.getByLabelText('輸入訊息'), '這是什麼{Enter}');
    await screen.findByText('這是圖片的說明');
    expect(screen.queryByRole('button', { name: '重新產生回覆' })).not.toBeInTheDocument();
  });
});

describe('restoring while the user already started typing', () => {
  test('keeps the draft, shows the saved conversation and announces it', async () => {
    const { announce } = await import('@utils/announce');
    localStorage.setItem(`${STORAGE_PREFIX}a`, JSON.stringify({
      savedAt: Date.now(), tribe: 'tayal',
      messages: [{ id: '1', role: 'user', text: '舊問題' }, { id: '2', role: 'bot', text: '舊回覆', sig: 'e'.repeat(64) }],
    }));
    apiGet.mockResolvedValue({ remaining: 50, resetsAt: null, features: {} });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    await userEvent.setup().type(screen.getByLabelText('輸入訊息'), '新草稿');
    expect(await screen.findByText('舊回覆')).toBeInTheDocument();
    expect(screen.getByLabelText('輸入訊息')).toHaveValue('新草稿');
    expect(announce).toHaveBeenCalledWith('已還原先前的對話');
  });
});

describe('BotReplyActions unmounted before the clipboard answers', () => {
  test('does not set state or arm a timer afterwards', async () => {
    let resolveWrite;
    const writeText = vi.fn(() => new Promise((r) => { resolveWrite = r; }));
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });   // setup() 會換掉 clipboard，要在它之後覆蓋
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const { unmount } = render(<BotReplyActions text="內容" canRegenerate={false} onRegenerate={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '複製回覆' }));
    unmount();
    const before = spy.mock.calls.length;
    await act(async () => { resolveWrite(); });
    expect(spy.mock.calls.length).toBe(before);
    spy.mockRestore();
  });
});

describe('BotReplyActions copy edge cases', () => {
  test('a rejected clipboard shows the failure and a double click only copies twice, never errors', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<BotReplyActions text="內容" canRegenerate={false} onRegenerate={vi.fn()} />);
    await user.dblClick(screen.getByRole('button', { name: '複製回覆' }));
    expect(await screen.findByRole('button', { name: '複製失敗，請手動選取' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  test('regenerate is ignored while disabled, even if clicked repeatedly', async () => {
    const onRegenerate = vi.fn();
    const user = userEvent.setup();
    render(<BotReplyActions text="內容" canRegenerate disabled onRegenerate={onRegenerate} />);
    await user.dblClick(screen.getByRole('button', { name: '重新產生回覆' }));
    expect(onRegenerate).not.toHaveBeenCalled();
  });
});
