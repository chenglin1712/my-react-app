import { describe, test, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TrackedStudyPlan from './TrackedStudyPlan';
import { apiPost } from '../../utils/apiClient';
import { applyReplan, getTrackedPlan, ReplanConflictError, setTaskDone, stopTracking } from '../../src/userServives/studyPlanService';

vi.mock('../../utils/apiClient', () => ({ apiPost: vi.fn() }));
vi.mock('@utils/announce', () => ({ announce: vi.fn() }));
vi.mock('../../src/userServives/studyPlanService', () => {
  class ReplanConflictError extends Error {
    constructor(reason) { super(reason); this.reason = reason; }
  }
  return {
    ReplanConflictError,
    getTrackedPlan: vi.fn(),
    setTaskDone: vi.fn(),
    applyReplan: vi.fn(),
    stopTracking: vi.fn(),
  };
});

const task = (id, over = {}) => ({
  id, summary: `任務${id}`, description: '', done: false,
  start: '2026-10-23T09:00:00+08:00', end: '2026-10-23T10:00:00+08:00', ...over,
});
const PLAN = { title: '一週讀書計畫', tasks: [task('a', { done: true }), task('b'), task('c')] };

beforeEach(() => {
  apiPost.mockReset();
  getTrackedPlan.mockReset().mockResolvedValue(PLAN);
  setTaskDone.mockReset();
  applyReplan.mockReset();
  stopTracking.mockReset();
});

const open = async (props = {}) => {
  const user = userEvent.setup();
  render(<TrackedStudyPlan tribe="tayal" {...props} />);
  await user.click(await screen.findByRole('button', { name: /一週讀書計畫/ }));
  return user;
};

const startReplan = async (user) => {
  await user.click(screen.getByRole('button', { name: '請助手重排未完成的任務' }));
  await user.click(screen.getByRole('button', { name: '重排' }));
};

describe('TrackedStudyPlan', () => {
  test('勾選之前開始的載入，結果回來時不蓋掉畫面，寫入結束後再重讀一次', async () => {
    let resolveStale;
    const { rerender } = render(<TrackedStudyPlan tribe="tayal" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /一週讀書計畫/ }));
    const taskB = screen.getByRole('checkbox', { name: /任務b/ });
    // refreshKey 變動：開始一次新的載入，但它的結果拖到最後才回來
    getTrackedPlan.mockReset()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }))
      .mockResolvedValue({ ...PLAN, tasks: [task('a', { done: true }), task('b', { done: true }), task('c')] });
    setTaskDone.mockResolvedValue([task('a', { done: true }), task('b', { done: true }), task('c')]);
    rerender(<TrackedStudyPlan tribe="tayal" refreshKey={1} />);
    await waitFor(() => expect(getTrackedPlan).toHaveBeenCalledTimes(1));

    await user.click(taskB);
    await waitFor(() => expect(setTaskDone).toHaveBeenCalledWith('b', true));
    await act(async () => { resolveStale(PLAN); });                           // 勾選前的快照：任務 b 還是未完成

    await waitFor(() => expect(getTrackedPlan).toHaveBeenCalledTimes(2));     // 寫入結束後補讀
    expect(screen.getByRole('checkbox', { name: /任務b/ })).toBeChecked();
  });

  test('結束追蹤之前開始的載入，結果回來時不會讓計畫重新出現', async () => {
    let resolveStale;
    stopTracking.mockResolvedValue(undefined);
    const { rerender, container } = render(<TrackedStudyPlan tribe="tayal" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /一週讀書計畫/ }));
    getTrackedPlan.mockReset().mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }));
    rerender(<TrackedStudyPlan tribe="tayal" refreshKey={1} />);
    await waitFor(() => expect(getTrackedPlan).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: '結束追蹤' }));
    await user.click(screen.getByRole('button', { name: '結束追蹤' }));
    await waitFor(() => expect(stopTracking).toHaveBeenCalled());
    await act(async () => { resolveStale(PLAN); });
    expect(container).toBeEmptyDOMElement();
  });

  test('沒有追蹤中的計畫時整塊不顯示', async () => {
    getTrackedPlan.mockResolvedValue(null);
    const { container } = render(<TrackedStudyPlan tribe="tayal" />);
    await waitFor(() => expect(getTrackedPlan).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  test('讀取失敗也不顯示、不影響聊天', async () => {
    getTrackedPlan.mockRejectedValue(new Error('offline'));
    const { container } = render(<TrackedStudyPlan tribe="tayal" />);
    await waitFor(() => expect(getTrackedPlan).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  test('標題列顯示進度，展開後列出任務與已勾選狀態', async () => {
    await open();
    expect(screen.getByText('1／3 完成')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /任務a/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /任務b/ })).not.toBeChecked();
  });

  test('勾選任務會存起來，畫面立刻更新進度', async () => {
    setTaskDone.mockResolvedValue([task('a', { done: true }), task('b', { done: true }), task('c')]);
    const user = await open();
    await user.click(screen.getByRole('checkbox', { name: /任務b/ }));
    expect(setTaskDone).toHaveBeenCalledWith('b', true);
    expect(await screen.findByText('2／3 完成')).toBeInTheDocument();
  });

  test('儲存失敗時還原勾選並提示', async () => {
    setTaskDone.mockRejectedValue(new Error('x'));
    const user = await open();
    await user.click(screen.getByRole('checkbox', { name: /任務b/ }));
    expect(await screen.findByText('沒有儲存成功，請稍後再試。')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /任務b/ })).not.toBeChecked();
    expect(screen.getByText('1／3 完成')).toBeInTheDocument();
  });

  test('連續勾選依點擊順序一筆一筆寫，最後的狀態是最後一次點擊', async () => {
    const order = [];
    setTaskDone.mockImplementation(async (id, done) => {
      order.push([id, done]);
      return PLAN.tasks.map((t) => (t.id === id ? { ...t, done } : t));
    });
    const user = await open();
    const box = screen.getByRole('checkbox', { name: /任務b/ });
    await user.click(box);
    await user.click(box);
    await waitFor(() => expect(order).toEqual([['b', true], ['b', false]]));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /任務b/ })).not.toBeChecked());
  });

  test('旗標沒開時不顯示重排按鈕', async () => {
    await open({ replanEnabled: false });
    expect(screen.queryByRole('button', { name: /重排/ })).not.toBeInTheDocument();
  });

  test('全部完成時沒有東西可重排，不顯示按鈕', async () => {
    getTrackedPlan.mockResolvedValue({ title: '一週讀書計畫', tasks: [task('a', { done: true })] });
    await open({ replanEnabled: true });
    expect(screen.queryByRole('button', { name: /請助手重排/ })).not.toBeInTheDocument();
  });

  test('重排：送出可用時間，成功後套用結果並更新額度', async () => {
    const result = { events: [{ summary: '新', start: 's', end: 'e' }], replaced_ids: ['b', 'c'], quota: { remaining: 9, limit: 10, resetsAt: null } };
    apiPost.mockResolvedValue(result);
    applyReplan.mockResolvedValue([task('a', { done: true }), task('n1'), task('n2')]);
    const onQuota = vi.fn();
    const user = await open({ replanEnabled: true, onQuota });

    await user.click(screen.getByRole('button', { name: '請助手重排未完成的任務' }));
    await user.type(screen.getByLabelText('可用時間（選填）'), '週末整天');
    await user.click(screen.getByRole('button', { name: '重排' }));

    expect(apiPost).toHaveBeenCalledWith(expect.stringContaining('replan_study_plan'), { tribe: 'tayal', availability: '週末整天' }, expect.anything());
    expect(applyReplan).toHaveBeenCalledWith(result);
    expect(await screen.findByText(/已重新安排還沒完成的任務/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /任務a/ })).toBeChecked();
    expect(onQuota).toHaveBeenCalledWith(result.quota);
  });

  test('重排期間計畫有變動：不套用、提示重試並重新讀取', async () => {
    apiPost.mockResolvedValue({ events: [{}], replaced_ids: ['b'] });
    applyReplan.mockRejectedValue(new ReplanConflictError('changed'));
    const user = await open({ replanEnabled: true });
    await startReplan(user);
    expect(await screen.findByText(/計畫在重排期間有變動/)).toBeInTheDocument();
    expect(getTrackedPlan).toHaveBeenCalledTimes(2);
  });

  test('助手拒答：顯示說明，不套用', async () => {
    apiPost.mockResolvedValue({ refused: true, message: '這個要求我沒辦法處理。' });
    const user = await open({ replanEnabled: true });
    await startReplan(user);
    expect(await screen.findByText('這個要求我沒辦法處理。')).toBeInTheDocument();
    expect(applyReplan).not.toHaveBeenCalled();
  });

  test('今天的額度用完：顯示明確的說明', async () => {
    apiPost.mockRejectedValue({ status: 429, data: { code: 'ai_daily_quota_exceeded' } });
    const user = await open({ replanEnabled: true });
    await startReplan(user);
    expect(await screen.findByText(/今天的提問次數已經用完了/)).toBeInTheDocument();
  });

  test('結束追蹤要行內確認，確認後整塊消失', async () => {
    stopTracking.mockResolvedValue();
    const user = await open();
    await user.click(screen.getByRole('button', { name: '結束追蹤' }));
    expect(stopTracking).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '結束追蹤' }));      // 確認區裡的按鈕
    await waitFor(() => expect(stopTracking).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('region', { name: '追蹤中的讀書計畫' })).not.toBeInTheDocument());
  });
});
