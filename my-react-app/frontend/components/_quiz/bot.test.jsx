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

  test('AI 助手被管理者關閉（403）時，顯示後端的說明，不當成網路錯誤', async () => {
    apiPost.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403, data: { detail: 'AI 助手目前暫停服務，請稍後再試。', code: 'ai_assistant_disabled' } }));
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), '你好{Enter}');

    expect(await screen.findByText('AI 助手目前暫停服務，請稍後再試。')).toBeInTheDocument();
    expect(screen.queryByText('很抱歉，無法取得回應，請稍後再試。')).toBeNull();
  });

  test('不是總開關造成的 403（沒有指定 code）仍顯示通用錯誤訊息', async () => {
    apiPost.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403, data: { detail: '代理層拒絕' } }));
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), '你好{Enter}');

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

  test('是非 modal 的懸浮視窗：焦點在輸入框、Esc 收合，Tab 可以離開視窗去操作頁面', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<><button type="button">頁面上的按鈕</button><AIAssistantOverlay onClose={onClose} /></>);

    expect(screen.getByLabelText('輸入訊息')).toHaveFocus();
    const dialog = screen.getByRole('dialog', { name: '族語 AI 助手' });
    expect(dialog).toHaveAttribute('aria-modal', 'false');

    // 沒有被困住：反覆 Shift+Tab 最終會回到頁面上的按鈕
    let leftDialog = false;
    for (let i = 0; i < 12; i += 1) {
      await user.tab({ shift: true });
      if (!dialog.contains(document.activeElement)) { leftDialog = true; break; }
    }
    expect(leftDialog).toBe(true);
    // 焦點在視窗外按 Esc 不會收合
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();

    // 焦點回到視窗內再按 Esc 才收合
    screen.getByLabelText('輸入訊息').focus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('沒有全螢幕遮罩，也不鎖背景捲動', () => {
    document.body.style.overflow = '';
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe('');
    expect(document.querySelector('.bot-overlay').getAttribute('data-open')).toBe('true');
  });

  test('open=false 時視窗收合並 inert，但對話內容保留；再開啟時還在', async () => {
    apiPost.mockResolvedValue({ message: '保留這則' });
    const user = userEvent.setup();
    const { rerender, container } = render(<AIAssistantOverlay onClose={vi.fn()} open />);
    await user.type(screen.getByLabelText('輸入訊息'), '你好{Enter}');
    expect(await screen.findByText('保留這則')).toBeInTheDocument();

    rerender(<AIAssistantOverlay onClose={vi.fn()} open={false} />);
    const wrap = container.querySelector('.bot-overlay');
    expect(wrap).toHaveAttribute('data-open', 'false');
    expect(wrap.hasAttribute('inert')).toBe(true);
    expect(screen.getByText('保留這則')).toBeInTheDocument();

    rerender(<AIAssistantOverlay onClose={vi.fn()} open />);
    expect(wrap.hasAttribute('inert')).toBe(false);
    expect(screen.getByLabelText('輸入訊息')).toHaveFocus();
  });

  test('收合後焦點回到 returnFocusRef 指定的啟動鈕', () => {
    const launcher = document.createElement('button');
    document.body.appendChild(launcher);
    const returnFocusRef = { current: launcher };
    const { rerender } = render(<AIAssistantOverlay onClose={vi.fn()} open returnFocusRef={returnFocusRef} />);
    expect(screen.getByLabelText('輸入訊息')).toHaveFocus();
    rerender(<AIAssistantOverlay onClose={vi.fn()} open={false} returnFocusRef={returnFocusRef} />);
    expect(launcher).toHaveFocus();
    launcher.remove();
  });

  test('使用者已經去操作頁面別處時，收合不會把焦點搶走', () => {
    const launcher = document.createElement('button');
    const other = document.createElement('button');
    document.body.append(launcher, other);
    const returnFocusRef = { current: launcher };
    const { rerender } = render(<AIAssistantOverlay onClose={vi.fn()} open returnFocusRef={returnFocusRef} />);
    other.focus();
    rerender(<AIAssistantOverlay onClose={vi.fn()} open={false} returnFocusRef={returnFocusRef} />);
    expect(other).toHaveFocus();
    launcher.remove();
    other.remove();
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

const announceSpy = vi.hoisted(() => vi.fn());
vi.mock('@utils/announce', () => ({ announce: announceSpy }));

describe('AIAssistantOverlay 開場白與準確度提醒（E-9，P2-74）', () => {
  beforeEach(() => {
    apiPost.mockReset();
    getUserSituation.mockReset();
    getUserSituation.mockResolvedValue({ level: 'beginner' });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    authState.userData = { firestoreData: { user_errors: {}, quiz_model: { type_stats: {} } } };
  });

  test('預設泰雅語：開場白帶有泰雅語問候詞與語別', () => {
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    expect(screen.getByText(/lokah su 你好！我是您的泰雅語 AI 助手/)).toBeInTheDocument();
  });

  test('對話還沒開始就換族語：開場白跟著換，且不會帶別的族語的問候詞', async () => {
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('選擇族語'), 'amis');

    expect(screen.getByText(/你好！我是您的阿美語 AI 助手/)).toBeInTheDocument();
    expect(screen.queryByText(/lokah su/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/AI 助手，有什麼我可以幫您的嗎/)).toHaveLength(1);
    expect(announceSpy).toHaveBeenCalledWith('已切換為阿美語');
  });

  test('已經聊過再換族語：保留對話，另外加一句說明改用哪個族語（不重複公告）', async () => {
    announceSpy.mockClear();
    apiPost.mockResolvedValue({ message: '好的' });
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    await user.type(screen.getByLabelText('輸入訊息'), '嗨{Enter}');
    await screen.findByText('好的');

    await user.selectOptions(screen.getByLabelText('選擇族語'), 'bunun');

    expect(screen.getByText(/lokah su 你好！我是您的泰雅語 AI 助手/)).toBeInTheDocument();
    expect(screen.getByText('已切換為布農語，接下來的問題會以布農語回答。')).toBeInTheDocument();
    expect(announceSpy).not.toHaveBeenCalled();
  });

  test('畫面上有常駐的準確度提醒，並綁給輸入框', () => {
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    expect(screen.getByText(/AI 可能寫錯族語的詞彙或拼寫/)).toBeInTheDocument();
    expect(screen.getByLabelText('輸入訊息')).toHaveAccessibleDescription(/請以族語辭典為準/);
  });
});
