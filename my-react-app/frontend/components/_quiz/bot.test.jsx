import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AIAssistantOverlay from './bot';
import { apiGet, apiPost, apiStream } from '../../utils/apiClient';

vi.mock('../../utils/apiClient', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiStream: vi.fn() }));
vi.mock('./bot_study_plan', () => ({ default: () => null }));

// 詞條卡片的發音：真的 hook 會載入 firebase 授權的音檔請求，測試只關心有沒有呼叫、用哪個音檔編號
const playAudioMock = vi.hoisted(() => vi.fn());
const failedAudioMock = vi.hoisted(() => ({ current: new Set() }));
vi.mock('../../hooks/useAuthorizedAudioPlayback', () => ({
  default: () => ({ playAudio: playAudioMock, failedAudio: failedAudioMock.current }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

describe('AIAssistantOverlay（回歸測試：注音/拼音輸入法選字時的 Enter 不該送出訊息）', () => {
  beforeEach(() => {
    apiPost.mockReset();
    // 剩餘次數是輔助資訊：預設讀不到（不顯示），個別測試再覆寫
    apiGet.mockReset();
    apiGet.mockRejectedValue(new Error('no quota'));
    // jsdom 沒有實作 scrollIntoView
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  test('請求不再帶前端自組的學習資料（user_stats），由伺服器依登入身分讀取', async () => {
    apiPost.mockResolvedValue({ message: 'ok' });
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), '嗨{Enter}');

    expect(await screen.findByText('ok')).toBeInTheDocument();
    const body = apiPost.mock.calls[0][1];
    expect(body).not.toHaveProperty('user_stats');
    expect(body).toMatchObject({ message: '嗨', tribe: 'tayal' });
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

  test('追問時把前面的對話一起送出，第一句沒有上文；失敗的那一輪不會被當成上文', async () => {
    const sig = 'b'.repeat(64);
    apiPost.mockResolvedValueOnce({ message: '加油的意思', sig }).mockResolvedValueOnce({ message: '唸作 lokah', sig });
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), 'lokah 是什麼意思{Enter}');
    await screen.findByText('加油的意思');
    await user.type(screen.getByLabelText('輸入訊息'), '它怎麼唸{Enter}');
    await screen.findByText('唸作 lokah');

    expect(apiPost.mock.calls[0][1].history).toEqual([]);
    expect(apiPost.mock.calls[1][1].history).toEqual([
      { role: 'user', text: 'lokah 是什麼意思' },
      { role: 'assistant', text: '加油的意思', sig },
    ]);
  });

  test('同一個事件迴圈內連按兩次 Enter 也只送出一次', async () => {
    let resolveApiPost;
    apiPost.mockImplementation(() => new Promise((resolve) => { resolveApiPost = resolve; }));
    const { fireEvent } = await import('@testing-library/react');
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    const input = screen.getByLabelText('輸入訊息');

    fireEvent.change(input, { target: { value: '你好' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(apiPost).toHaveBeenCalledTimes(1);
    resolveApiPost({ message: '回應' });
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
    // 等待中送出鈕變成「停止」（路線圖 #33），不管有沒有串流
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();
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

    expect(await screen.findByText('連不上伺服器，請檢查網路連線後再試。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重試' })).toBeInTheDocument();
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

    expect(await screen.findByText('目前無法使用 AI 助手，請稍後再試。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重試' })).not.toBeInTheDocument();   // 重試不會有用
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

describe('AIAssistantOverlay 每日提問額度與拒答（路線圖 #5、#6）', () => {
  const RESETS = '2026-10-22T00:00:00+08:00';

  beforeEach(() => {
    apiPost.mockReset();
    apiGet.mockReset();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  test('開啟時讀取並顯示今天還可以問幾次', async () => {
    apiGet.mockResolvedValue({ limit: 100, remaining: 87, resetsAt: RESETS, tracked: true });
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    expect(await screen.findByText('今天還可以問 87 次')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/AIModel/quota/');
    // 次數還多時是安靜的小字，不是狀態通知
    expect(screen.getByText('今天還可以問 87 次')).not.toHaveAttribute('role');
  });

  test('伺服器說計數不可信（tracked false）或讀取失敗時不顯示次數，也不擋提問', async () => {
    apiGet.mockResolvedValue({ limit: 100, remaining: 100, resetsAt: RESETS, tracked: false });
    apiPost.mockResolvedValue({ message: '回答' });
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), '你好{Enter}');

    expect(await screen.findByText('回答')).toBeInTheDocument();
    expect(screen.queryByText(/今天還可以問/)).not.toBeInTheDocument();
  });

  test('回應帶回新的剩餘次數就更新；剩下很少時改成會被報讀器念出的提醒', async () => {
    apiGet.mockResolvedValue({ limit: 100, remaining: 6, resetsAt: RESETS, tracked: true });
    apiPost.mockResolvedValue({ message: '回答', quota: { limit: 100, remaining: 5, resetsAt: RESETS, tracked: true } });
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    await screen.findByText('今天還可以問 6 次');

    await user.type(screen.getByLabelText('輸入訊息'), '你好{Enter}');

    const line = await screen.findByText('今天還可以問 5 次');
    expect(line).toHaveAttribute('role', 'status');
    expect(line).toHaveAttribute('data-state', 'low');
  });

  test('剩 0 次時說明重置時間、不再送出，輸入框提示也跟著改', async () => {
    apiGet.mockResolvedValue({ limit: 100, remaining: 0, resetsAt: RESETS, tracked: true });
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    expect(await screen.findByText('今天的提問次數已用完，台灣時間 00:00重置。')).toBeInTheDocument();
    expect(screen.getByLabelText('輸入訊息')).toHaveAttribute('placeholder', '今天的提問次數已用完');
    expect(screen.getByRole('button', { name: '發送' })).toHaveAttribute('aria-disabled', 'true');

    await user.type(screen.getByLabelText('輸入訊息'), '還想問{Enter}');
    expect(apiPost).not.toHaveBeenCalled();
  });

  test('後端回 429（今天的次數用完）時顯示重置時間並停用送出', async () => {
    apiGet.mockRejectedValue(new Error('no quota'));
    apiPost.mockRejectedValue(Object.assign(new Error('too many'), {
      status: 429,
      data: { code: 'ai_daily_quota_exceeded', quota: { limit: 100, remaining: 0, resetsAt: RESETS, tracked: true } },
    }));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), '你好{Enter}');

    // 對話紀錄裡一則、輸入區上方一行，說的是同一件事
    expect((await screen.findAllByText('今天的提問次數已用完，台灣時間 00:00重置。')).length).toBe(2);
    expect(screen.queryByText('很抱歉，無法取得回應，請稍後再試。')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '發送' })).toHaveAttribute('aria-disabled', 'true');
    consoleErrorSpy.mockRestore();
  });

  test('模型拒答時顯示固定說明並與一般回覆區分，仍帶簽章供之後的對話紀錄使用', async () => {
    apiGet.mockRejectedValue(new Error('no quota'));
    const sig = 'c'.repeat(64);
    apiPost.mockResolvedValueOnce({ message: '這個問題我沒辦法回答，換個方式問問看。', refused: true, sig })
      .mockResolvedValueOnce({ message: '好的' });
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), '某個問題{Enter}');
    const note = await screen.findByText('這個問題我沒辦法回答，換個方式問問看。');
    expect(note.closest('.message-bubble')).toHaveAttribute('data-kind', 'refusal');

    await user.type(screen.getByLabelText('輸入訊息'), '換個問法{Enter}');
    await screen.findByText('好的');
    expect(apiPost.mock.calls[1][1].history).toEqual([
      { role: 'user', text: '某個問題' },
      { role: 'assistant', text: '這個問題我沒辦法回答，換個方式問問看。', sig },
    ]);
  });
});

describe('AIAssistantOverlay 串流回覆（路線圖 #9）', () => {
  const STREAM_URL = '/AIModel/tayal_chat/stream/';
  const sig = 'd'.repeat(64);

  // 手動控制的串流：測試決定什麼時候送出片段、什麼時候結束或失敗
  const controlledStream = () => {
    const control = {};
    apiStream.mockImplementation((_url, _body, { signal, onDelta }) => {
      control.onDelta = onDelta;
      control.signal = signal;
      return new Promise((resolve, reject) => {
        control.finish = resolve;
        control.fail = reject;
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    });
    return control;
  };

  beforeEach(() => {
    vi.stubEnv('VITE_API_AI_BOT_STREAM_URL', STREAM_URL);
    apiPost.mockReset();
    apiStream.mockReset();
    apiGet.mockReset();
    apiGet.mockRejectedValue(new Error('no quota'));
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('有設定串流網址就走串流：文字一段一段長在同一個氣泡，完成後以後端的完整文字與簽章為準', async () => {
    const control = controlledStream();
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), '你好{Enter}');
    expect(apiStream.mock.calls[0][0]).toBe(STREAM_URL);
    expect(apiPost).not.toHaveBeenCalled();
    control.onDelta('哈');
    control.onDelta('囉');
    expect(await screen.findByText('哈囉')).toBeInTheDocument();
    // 串流中：氣泡標示忙碌、文字對報讀器隱藏，不再另外顯示「輸入中」的三個點
    const bubble = screen.getByText('哈囉').closest('.message-bubble');
    expect(bubble).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('哈囉')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByText('助手正在輸入')).not.toBeInTheDocument();

    control.finish({ message: '哈囉，同學', sig });

    expect(await screen.findByText('哈囉，同學')).toBeInTheDocument();
    expect(screen.queryByText('哈囉')).not.toBeInTheDocument(); // 同一個氣泡被換成完整文字，沒有重複
    expect(screen.getByText('哈囉，同學')).not.toHaveAttribute('aria-hidden');
    expect(screen.getByText('哈囉，同學').closest('.message-bubble')).not.toHaveAttribute('aria-busy');
  });

  test('串流完成後念一次完整內容給報讀器（串流中的片段不念）', async () => {
    const control = controlledStream();
    announceSpy.mockClear();
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), '你好{Enter}');
    control.onDelta('哈囉');
    await screen.findByText('哈囉');
    expect(announceSpy).not.toHaveBeenCalled();
    control.finish({ message: '哈囉，同學', sig });
    await screen.findByText('哈囉，同學');

    expect(announceSpy).toHaveBeenCalledTimes(1);
    expect(announceSpy).toHaveBeenCalledWith('哈囉，同學');
  });

  test('回覆進行中，發送鈕變成「停止」；按下去保留已經收到的文字並標示已停止，可以重試', async () => {
    const control = controlledStream();
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), '你好{Enter}');
    expect(screen.queryByRole('button', { name: '發送' })).not.toBeInTheDocument();
    control.onDelta('說到一半');
    await screen.findByText('說到一半');

    await user.click(screen.getByRole('button', { name: '停止' }));

    expect(control.signal.aborted).toBe(true);
    expect(await screen.findByText('已停止回覆')).toBeInTheDocument();
    expect(screen.getByLabelText('輸入訊息')).toHaveFocus();      // 停止鈕被換掉後焦點不會掉到頁面最上面
    expect(screen.getByText('說到一半')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '發送' })).toBeInTheDocument(); // 按鈕換回來
    expect(screen.getByRole('button', { name: '重試' })).toBeInTheDocument();
  });

  test('一個字都還沒收到就按停止：只留一則「已停止回覆」，沒有空氣泡', async () => {
    controlledStream();
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), '你好{Enter}');
    await user.click(screen.getByRole('button', { name: '停止' }));

    expect(await screen.findByText('已停止回覆。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重試' })).not.toBeInTheDocument();
  });

  test('中途斷線：保留半截文字但標示「回覆中斷了」，不當成完整回覆；重試會重送同一句並換掉中斷的那則', async () => {
    const control = controlledStream();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), '你好{Enter}');
    control.onDelta('半截');
    await screen.findByText('半截');
    control.fail(Object.assign(new Error('斷線'), { partial: true }));

    expect(await screen.findByText('回覆中斷了')).toBeInTheDocument();
    expect(screen.getByText('半截').closest('.message-bubble')).toHaveAttribute('data-kind', 'interrupted');

    // 重試：同一句再送一次，使用者的問題不會重複出現，歷史也不含中斷的那則
    const retry = controlledStream();
    await user.click(screen.getByRole('button', { name: '重試' }));
    expect(apiStream).toHaveBeenCalledTimes(2);
    expect(apiStream.mock.calls[1][1]).toMatchObject({ message: '你好', history: [] });
    retry.onDelta('完整');
    retry.finish({ message: '完整的回答', sig });

    expect(await screen.findByText('完整的回答')).toBeInTheDocument();
    expect(screen.queryByText('半截')).not.toBeInTheDocument();
    expect(screen.getAllByText('你好')).toHaveLength(1);
    consoleErrorSpy.mockRestore();
  });

  test('還沒收到任何文字就失敗：顯示一般的錯誤訊息，不是「回覆中斷」', async () => {
    apiStream.mockRejectedValue(Object.assign(new Error('x'), { status: 502, partial: false }));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), '你好{Enter}');

    expect(await screen.findByText('AI 服務暫時無法回應，請稍後再試。')).toBeInTheDocument();
    expect(screen.queryByText('回覆中斷了')).not.toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  test('串流前的 429（今天的次數用完）和不串流時一樣處理', async () => {
    apiStream.mockRejectedValue(Object.assign(new Error('too many'), {
      status: 429,
      data: { code: 'ai_daily_quota_exceeded', quota: { limit: 100, remaining: 0, resetsAt: '2026-10-22T00:00:00+08:00', tracked: true } },
    }));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), '你好{Enter}');

    expect((await screen.findAllByText('今天的提問次數已用完，台灣時間 00:00重置。')).length).toBe(2);
    consoleErrorSpy.mockRestore();
  });

  test('拒答發生在已經顯示部分文字之後：整則換成固定說明，已顯示的內容不留', async () => {
    const control = controlledStream();
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), '某個問題{Enter}');
    control.onDelta('開頭的幾句');
    await screen.findByText('開頭的幾句');
    control.finish({ message: '這個問題我沒辦法回答，換個方式問問看。', refused: true, sig });

    const note = await screen.findByText('這個問題我沒辦法回答，換個方式問問看。');
    expect(note.closest('.message-bubble')).toHaveAttribute('data-kind', 'refusal');
    expect(screen.queryByText('開頭的幾句')).not.toBeInTheDocument();
  });

  test('讀書計畫這類不串流的回覆（直接收到 done）照樣顯示，不需要先有片段', async () => {
    apiStream.mockResolvedValue({ message: '已經為你排好計畫', study_plan: { title: 't', events: [] }, sig });
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), '幫我排計畫{Enter}');

    expect(await screen.findByText('已經為你排好計畫')).toBeInTheDocument();
  });

  test('完成的串流回覆帶著簽章，下一句會被當成對話記憶送回去', async () => {
    apiStream.mockResolvedValueOnce({ message: '第一個回答', sig }).mockResolvedValueOnce({ message: '第二個回答', sig });
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), '第一問{Enter}');
    await screen.findByText('第一個回答');
    await user.type(screen.getByLabelText('輸入訊息'), '第二問{Enter}');
    await waitFor(() => expect(apiStream).toHaveBeenCalledTimes(2));

    expect(apiStream.mock.calls[1][1].history).toEqual([
      { role: 'user', text: '第一問' },
      { role: 'assistant', text: '第一個回答', sig },
    ]);
  });

  test('沒有設定串流網址時維持原本的做法（apiPost，沒有停止鈕）', async () => {
    vi.stubEnv('VITE_API_AI_BOT_STREAM_URL', '');
    apiPost.mockResolvedValue({ message: '舊做法的回答' });
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), '你好{Enter}');

    expect(await screen.findByText('舊做法的回答')).toBeInTheDocument();
    expect(apiStream).not.toHaveBeenCalled();
  });
});

describe('AIAssistantOverlay 辭典詞條卡片（路線圖 #17）', () => {
  const sig = 'e'.repeat(64);
  const entries = [
    { word_id: 'w1', word: 'lokah', chinese: '你好；加油', audio: 'f1' },
    { word_id: 'w2', word: 'su', chinese: '你', audio: '' },
  ];

  beforeEach(() => {
    vi.stubEnv('VITE_API_AI_BOT_STREAM_URL', '');
    apiPost.mockReset();
    apiGet.mockReset();
    apiGet.mockRejectedValue(new Error('no quota'));
    playAudioMock.mockReset();
    failedAudioMock.current = new Set();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const ask = async (reply) => {
    apiPost.mockResolvedValue(reply);
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    await user.type(screen.getByLabelText('輸入訊息'), 'lokah 是什麼{Enter}');
    return user;
  };

  test('回覆帶有詞條時，在同一個氣泡裡列出詞、中文解釋、發音鈕與辭典連結', async () => {
    await ask({ message: 'lokah 是你好', entries, sig });

    const list = await screen.findByRole('region', { name: '本次查到的辭典詞條' });
    expect(list).toHaveTextContent('lokah');
    expect(list).toHaveTextContent('你好；加油');
    expect(list.closest('.message-bubble')).toHaveTextContent('lokah 是你好');
  });

  test('辭典連結帶著詞與提問當下的族語，另開新分頁', async () => {
    await ask({ message: 'lokah 是你好', entries, sig });

    const link = await screen.findByRole('link', { name: '在辭典查看「lokah」（另開新分頁）' });
    expect(link).toHaveAttribute('href', '/search?q=lokah&tribe=tayal');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  test('有音檔的詞才有發音鈕，按下去用該詞的音檔編號播放', async () => {
    const user = await ask({ message: 'lokah 是你好', entries, sig });

    await user.click(await screen.findByRole('button', { name: '播放「lokah」的發音' }));

    expect(playAudioMock).toHaveBeenCalledWith('f1');
    expect(screen.queryByRole('button', { name: '播放「su」的發音' })).not.toBeInTheDocument();
  });

  test('音檔播放失敗過的詞，發音鈕換成文字說明，不是一顆按了沒反應的按鈕', async () => {
    failedAudioMock.current = new Set(['f1']);
    await ask({ message: 'lokah 是你好', entries, sig });

    expect(await screen.findByText('音檔無法播放')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '播放「lokah」的發音' })).not.toBeInTheDocument();
  });

  test('沒有詞條的回覆不出現卡片區塊', async () => {
    await ask({ message: '你好，同學', sig });

    await screen.findByText('你好，同學');
    expect(screen.queryByRole('region', { name: '本次查到的辭典詞條' })).not.toBeInTheDocument();
  });

  test('詞條資料不合法（缺詞、不是陣列）時略過，不讓畫面壞掉', async () => {
    await ask({ message: '回覆', entries: [{ word_id: 'x' }, null, 5], sig });

    await screen.findByText('回覆');
    expect(screen.queryByRole('region', { name: '本次查到的辭典詞條' })).not.toBeInTheDocument();
  });

  test('詞條不會被當成對話記憶送回去（只有簽章的文字會）', async () => {
    const user = await ask({ message: 'lokah 是你好', entries, sig });
    await screen.findByRole('region', { name: '本次查到的辭典詞條' });
    apiPost.mockResolvedValue({ message: '第二個回答', sig });

    await user.type(screen.getByLabelText('輸入訊息'), '再問一次{Enter}');
    await screen.findByText('第二個回答');

    expect(apiPost.mock.calls[1][1].history).toEqual([
      { role: 'user', text: 'lokah 是什麼' },
      { role: 'assistant', text: 'lokah 是你好', sig },
    ]);
  });

  test('回覆帶有辭典查無的詞形時，在回覆下方提醒（措辭是「查無此詞形」），詞連到辭典，回覆文字不變', async () => {
    await ask({ message: 'zzzq 是我編的', unverified: ['zzzq', 'yyyp'], sig });

    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('辭典查無此詞形：zzzq、yyyp');
    expect(note).toHaveTextContent('請再查辭典或請教老師');
    expect(note.textContent).not.toMatch(/錯誤|不正確|是錯的/);
    const link = screen.getByRole('link', { name: '在辭典查看「zzzq」（另開新分頁）' });
    expect(link).toHaveAttribute('href', '/search?q=zzzq&tribe=tayal');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText('zzzq 是我編的')).toBeInTheDocument();
  });

  test('沒有查無的詞形（或資料不合法）時不出現提醒', async () => {
    await ask({ message: '一切正常', unverified: [], sig });
    await screen.findByText('一切正常');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  test('提醒不會被當成對話記憶送回去', async () => {
    const user = await ask({ message: 'zzzq 是我編的', unverified: ['zzzq'], sig });
    await screen.findByRole('note');
    apiPost.mockResolvedValue({ message: '第二個回答', sig });

    await user.type(screen.getByLabelText('輸入訊息'), '再問{Enter}');
    await screen.findByText('第二個回答');

    expect(apiPost.mock.calls[1][1].history).toEqual([
      { role: 'user', text: 'lokah 是什麼' },
      { role: 'assistant', text: 'zzzq 是我編的', sig },
    ]);
  });

  test('串流路徑的 done 事件帶查無詞形時，完成後才出現提醒', async () => {
    vi.stubEnv('VITE_API_AI_BOT_STREAM_URL', '/AIModel/tayal_chat/stream/');
    apiStream.mockReset();
    apiStream.mockResolvedValue({ message: 'zzzq 是我編的', unverified: ['zzzq'], sig });
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), 'zzzq{Enter}');

    expect(await screen.findByRole('note')).toHaveTextContent('辭典查無此詞形：zzzq');
  });

  test('串流路徑的 done 事件帶詞條時同樣顯示', async () => {
    vi.stubEnv('VITE_API_AI_BOT_STREAM_URL', '/AIModel/tayal_chat/stream/');
    apiStream.mockReset();
    apiStream.mockResolvedValue({ message: 'lokah 是你好', entries, sig });
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('輸入訊息'), 'lokah{Enter}');

    expect(await screen.findByRole('region', { name: '本次查到的辭典詞條' })).toHaveTextContent('lokah');
  });
});

describe('AIAssistantOverlay 無障礙（審查項 P1-5、P1-6）', () => {
  beforeEach(() => {
    apiPost.mockReset();
    apiGet.mockReset();
    apiGet.mockRejectedValue(new Error('no quota'));
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
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
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
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
