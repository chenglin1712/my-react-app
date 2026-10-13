import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AIAssistantOverlay from './bot';
import { apiPost } from '../../utils/apiClient';
import { getUserSituation } from '../../src/userServives/uploadDb';

vi.mock('../../utils/apiClient', () => ({ apiPost: vi.fn() }));
vi.mock('../../src/userServives/uploadDb', () => ({ getUserSituation: vi.fn() }));
const authState = vi.hoisted(() => ({
  userData: { firestoreData: { user_errors: {}, quiz_model: { type_stats: {} } } },
}));
vi.mock('../../src/userServives/authContext', () => ({
  useAuth: () => ({ userData: authState.userData }),
}));
vi.mock('./bot_study_plan', () => ({ default: () => null }));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

describe('AIAssistantOverlay（回歸測試：注音/拼音輸入法選字時的 Enter 不該送出訊息）', () => {
  beforeEach(() => {
    apiPost.mockReset();
    getUserSituation.mockReset();
    getUserSituation.mockResolvedValue({ level: 'beginner' });
    // jsdom 沒有實作 scrollIntoView
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    authState.userData = { firestoreData: { user_errors: {}, quiz_model: { type_stats: {} } } };
  });

  test('Firestore 統計資料含 null／非數字項目時不會丟例外，仍能正常送出', async () => {
    authState.userData = {
      firestoreData: {
        user_errors: { word1: 3, word2: null, word3: 'x' },
        quiz_model: { type_stats: { choice: { n: 5, e: 2 }, broken: null } },
      },
    };
    apiPost.mockResolvedValue({ message: 'ok' });
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), '嗨{Enter}');

    expect(await screen.findByText('ok')).toBeInTheDocument();
    const stats = apiPost.mock.calls[0][1].user_stats;
    expect(stats.incorrect).toBe(3);
    expect(stats.correct).toBe(3);
  });

  test('聊天室外層使用專屬 class，不再沿用會與 Navbar 衝突的 .overlay', () => {
    const { container } = render(<AIAssistantOverlay onClose={vi.fn()} />);
    expect(container.querySelector('.bot-overlay')).toBeInTheDocument();
    expect(container.querySelector('.overlay')).not.toBeInTheDocument();
  });

  test('輸入法選字時按下的 Enter（isComposing）不會送出訊息', async () => {
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    const input = screen.getByLabelText('輸入訊息');

    await userEvent.type(input, '你好');
    // fireEvent 才能自訂 nativeEvent.isComposing，userEvent 目前不支援
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

    expect(apiPost).not.toHaveBeenCalled();
  });

  test('一般情況下按 Enter 會送出訊息', async () => {
    apiPost.mockResolvedValue({ message: '你好！' });
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    const input = screen.getByLabelText('輸入訊息');

    await user.type(input, '你好{Enter}');

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('你好！')).toBeInTheDocument();
  });

  test('回應還在等待時，輸入框標示忙碌、發送鈕標示不可用，且不能連續送出（不用 disabled，焦點才不會掉走）', async () => {
    let resolveApiPost;
    apiPost.mockImplementation(() => new Promise((resolve) => { resolveApiPost = resolve; }));
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    const input = screen.getByLabelText('輸入訊息');

    await user.type(input, '你好{Enter}');

    expect(screen.getByLabelText('輸入訊息')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText('輸入訊息')).not.toBeDisabled();
    expect(screen.getByLabelText('輸入訊息')).toHaveFocus();
    expect(screen.getByRole('button', { name: '發送' })).toHaveAttribute('aria-disabled', 'true');
    // 等待中再送一次也不會發出第二個請求
    await user.type(screen.getByLabelText('輸入訊息'), '再問一次{Enter}');
    expect(apiPost).toHaveBeenCalledTimes(1);

    resolveApiPost({ message: '回應' });
  });

  test('請求失敗時顯示一則通用錯誤訊息', async () => {
    apiPost.mockRejectedValue(new Error('network down'));
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    const input = screen.getByLabelText('輸入訊息');

    await user.type(input, '你好{Enter}');

    expect(await screen.findByText('很抱歉，無法取得回應，請稍後再試。')).toBeInTheDocument();
  });

  test('對話框卸載時會中止還在進行中的請求，恢復回應（真的被中止）時不當成錯誤處理', async () => {
    let capturedSignal;
    apiPost.mockImplementation((_url, _data, options) => {
      capturedSignal = options.signal;
      return new Promise(() => {}); // 故意讓它一直 pending，模擬還在等回應時就卸載
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    const { unmount } = render(<AIAssistantOverlay onClose={vi.fn()} />);
    const input = screen.getByLabelText('輸入訊息');

    await user.type(input, '你好{Enter}');
    expect(capturedSignal.aborted).toBe(false);

    unmount();

    // 卸載時的 cleanup 呼叫了同一個 AbortController 的 abort()
    expect(capturedSignal.aborted).toBe(true);
    consoleErrorSpy.mockRestore();
  });
});

describe('AIAssistantOverlay 無障礙（審查項 P1-5、P1-6）', () => {
  beforeEach(() => {
    apiPost.mockReset();
    getUserSituation.mockReset();
    getUserSituation.mockResolvedValue({ level: 'beginner' });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    authState.userData = { firestoreData: { user_errors: {}, quiz_model: { type_stats: {} } } };
  });

  test('開啟時焦點在輸入框；Esc 關閉；Tab 被困在對話框內', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={onClose} />);

    expect(screen.getByLabelText('輸入訊息')).toHaveFocus();
    const dialog = screen.getByRole('dialog', { name: '族語 AI 助手' });
    for (let i = 0; i < 12; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('關閉（卸載）後焦點回到開啟前的按鈕', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<AIAssistantOverlay onClose={vi.fn()} />);
    expect(opener).not.toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  test('對話紀錄是 role=log 的 polite live region，等待回覆時有「助手正在輸入」文字', async () => {
    let resolveApiPost;
    apiPost.mockImplementation(() => new Promise((resolve) => { resolveApiPost = resolve; }));
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    const log = screen.getByRole('log', { name: '對話紀錄' });
    expect(log).toHaveAttribute('aria-live', 'polite');

    await user.type(screen.getByLabelText('輸入訊息'), '你好{Enter}');
    expect(log).toHaveTextContent('助手正在輸入');
    resolveApiPost({ message: '回應' });
    expect(await screen.findByText('回應')).toBeInTheDocument();
    expect(log).not.toHaveTextContent('助手正在輸入');
  });

  test('送出訊息後焦點仍在輸入框，可以直接打下一則', async () => {
    apiPost.mockResolvedValue({ message: '好的' });
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    await user.type(screen.getByLabelText('輸入訊息'), '你好');
    await user.click(screen.getByRole('button', { name: '發送' }));
    expect(await screen.findByText('好的')).toBeInTheDocument();
    expect(screen.getByLabelText('輸入訊息')).toHaveFocus();
  });
});
