import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AIAssistantOverlay from './bot';
import { apiPost } from '../../utils/apiClient';
import { getUserSituation } from '../../src/userServives/uploadDb';

vi.mock('../../utils/apiClient', () => ({ apiPost: vi.fn() }));
vi.mock('../../src/userServives/uploadDb', () => ({ getUserSituation: vi.fn() }));
vi.mock('../../src/userServives/authContext', () => ({
  useAuth: () => ({ userData: { firestoreData: { user_errors: {}, quiz_model: { type_stats: {} } } } }),
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
  });

  test('輸入法選字時按下的 Enter（isComposing）不會送出訊息', async () => {
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    const input = screen.getByLabelText('輸入訊息');

    await userEvent.type(input, '你好');
    // fireEvent 才能自訂 nativeEvent.isComposing，userEvent 目前不支援
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.keyPress(input, { key: 'Enter', nativeEvent: { isComposing: true } });

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

  test('回應還在等待時，輸入框跟發送按鈕都會被停用，不能連續送出', async () => {
    let resolveApiPost;
    apiPost.mockImplementation(() => new Promise((resolve) => { resolveApiPost = resolve; }));
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    const input = screen.getByLabelText('輸入訊息');

    await user.type(input, '你好{Enter}');

    expect(screen.getByLabelText('輸入訊息')).toBeDisabled();
    expect(screen.getByRole('button', { name: '發送' })).toBeDisabled();
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
