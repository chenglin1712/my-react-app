import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AIAssistantOverlay from './bot';
import { apiGet, apiPost } from '../../utils/apiClient';
import { getTrackedPlan } from '../../src/userServives/studyPlanService';

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
vi.mock('../../src/userServives/studyPlanService', () => {
  class ReplanConflictError extends Error {}
  return {
    ReplanConflictError,
    getTrackedPlan: vi.fn(),
    setTaskDone: vi.fn(),
    applyReplan: vi.fn(),
    stopTracking: vi.fn(),
  };
});

const reply = (message) => ({ message, sig: 'e'.repeat(64) });
const task = (id) => ({
  id, summary: `任務${id}`, description: '', done: false,
  start: '2026-10-23T09:00:00+08:00', end: '2026-10-23T10:00:00+08:00',
});

// 目前登入的人；apiGet／getTrackedPlan 依他回不同的資料
let who = 'a';

beforeEach(() => {
  who = 'a';
  localStorage.clear();
  apiGet.mockReset().mockImplementation(async () => (
    who === 'a'
      ? { remaining: 0, resetsAt: null, features: {}, suggestions: ['A 的個人化建議'] }
      : { remaining: 50, resetsAt: null, features: {} }
  ));
  apiPost.mockReset();
  getTrackedPlan.mockReset().mockImplementation(async () => (who === 'a' ? { title: 'A 的讀書計畫', tasks: [task('a1')] } : null));
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('switching account while the assistant stays mounted', () => {
  test('the previous account quota and suggestions do not block the next account', async () => {
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('A 的個人化建議')).toBeInTheDocument();

    who = 'b';
    act(() => auth.listener({ uid: 'b' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));             // 為新帳號重讀額度
    await waitFor(() => expect(screen.queryByText('A 的個人化建議')).not.toBeInTheDocument());

    apiPost.mockResolvedValueOnce(reply('B 的回覆'));
    await user.type(await screen.findByLabelText('輸入訊息'), 'B 的問題{Enter}');
    expect(await screen.findByText('B 的回覆')).toBeInTheDocument();            // 沒被 A 用完的額度擋住
  });

  test('a quota response that arrives after the switch is not applied to the new account', async () => {
    let resolveA;
    apiGet.mockReset()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }))
      .mockResolvedValue({ remaining: 50, resetsAt: null, features: {} });
    const user = userEvent.setup();
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));

    who = 'b';
    act(() => auth.listener({ uid: 'b' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    await act(async () => { resolveA({ remaining: 0, resetsAt: null, features: {}, suggestions: ['A 的個人化建議'] }); });

    expect(screen.queryByText('A 的個人化建議')).not.toBeInTheDocument();
    apiPost.mockResolvedValueOnce(reply('B 的回覆'));
    await user.type(screen.getByLabelText('輸入訊息'), 'B 的問題{Enter}');
    expect(await screen.findByText('B 的回覆')).toBeInTheDocument();
  });

  test('logging out does not request the quota without an identity', async () => {
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    act(() => auth.listener(null));
    await act(async () => {});
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  test('the previous account custom greeting does not stay for the next account', async () => {
    apiGet.mockReset().mockImplementation(async () => (
      who === 'a'
        ? { remaining: 50, resetsAt: null, features: {}, greeting: 'A 的專屬開場白，我是{tribe}助手' }
        : { remaining: 50, resetsAt: null, features: {} }
    ));
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    expect(await screen.findByText(/A 的專屬開場白/)).toBeInTheDocument();

    who = 'b';
    act(() => auth.listener({ uid: 'b' }));
    await waitFor(() => expect(screen.queryByText(/A 的專屬開場白/)).not.toBeInTheDocument());
    expect(await screen.findByText(/你好！我是您的/)).toBeInTheDocument();
  });

  test('the tracked study plan of the previous account disappears and is reloaded for the next one', async () => {
    render(<AIAssistantOverlay onClose={vi.fn()} />);
    expect(await screen.findByRole('button', { name: /A 的讀書計畫/ })).toBeInTheDocument();

    who = 'b';
    act(() => auth.listener({ uid: 'b' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /A 的讀書計畫/ })).not.toBeInTheDocument());
    expect(getTrackedPlan).toHaveBeenCalledTimes(2);                           // 為新帳號重讀，不是沿用舊畫面

    act(() => auth.listener(null));                                            // 登出：不掛載
    expect(getTrackedPlan).toHaveBeenCalledTimes(2);
  });
});
