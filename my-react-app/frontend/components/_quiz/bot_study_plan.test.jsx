import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import StudyPlan from './bot_study_plan';
import { addCalendarEventsSkippingDuplicates as addDeduped } from '../../src/userServives/uploadDb';
import { ExistingPlanError, startTracking } from '../../src/userServives/studyPlanService';

/** 原本這裡有一份完全沒被讀取/顯示/存起來的本地 events state，「加入」「全部
 * 加入」實際上什麼都沒發生，卻在「全部加入」之後顯示「成功加入行事曆!」的
 * 動畫——使用者被騙以為存成功了。這裡驗證兩個按鈕都真的呼叫了 Firestore
 * 寫入函式，而不是只改本地 state。 */
// 稽核 FE4-09：讀書計畫改用會略過重複行程的寫入函式，回傳 { saved, skipped }
vi.mock('../../src/userServives/uploadDb', () => ({
  addCalendarEventsSkippingDuplicates: vi.fn(),
}));
const ok = (saved, skipped = 0) => ({ saved, skipped });
vi.mock('../../src/userServives/studyPlanService', () => ({
  ExistingPlanError: class ExistingPlanError extends Error {},
  startTracking: vi.fn(),
}));
vi.mock('lottie-web', () => ({ default: { loadAnimation: () => ({ addEventListener: vi.fn(), destroy: vi.fn() }) } }));

const PLAN = {
  title: '一週讀書計畫',
  events: [
    { summary: '複習單字', description: '複習前五課單字', start: '2026-03-05T09:00:00+08:00', end: '2026-03-05T10:00:00+08:00' },
    { summary: '練習發音', description: '', start: '2026-03-06T09:00:00+08:00', end: '2026-03-06T10:00:00+08:00' },
  ],
};

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('StudyPlan（回歸測試：加入行事曆原本完全是假的，只改本地 state）', () => {
  beforeEach(() => {
    addDeduped.mockReset();
    startTracking.mockReset();
  });

  test('沒有題目資料時不渲染任何內容', () => {
    const { container } = renderWithRouter(<StudyPlan plan={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('點選單一事件的「加入」會真的寫入行事曆，成功後顯示「已加入」', async () => {
    addDeduped.mockResolvedValue(ok([{ id: 'e1' }]));
    const user = userEvent.setup();
    renderWithRouter(<StudyPlan plan={PLAN} onClose={vi.fn()} />);

    await user.click(screen.getAllByRole('button', { name: /加入/ }).find((b) => b.className.includes('add-to-calendar-btn')));

    expect(addDeduped).toHaveBeenCalledWith([expect.objectContaining({ summary: '複習單字' })]);
    expect(await screen.findByText('已加入')).toBeInTheDocument();
  });

  test('點選「全部加入」只呼叫一次批次寫入，不是對每筆各自呼叫（回歸測試：原本用 Promise.all 平行呼叫 addCalendarEvent 會互相覆蓋遺失更新）', async () => {
    addDeduped.mockResolvedValue(ok([{ id: 'e1' }, { id: 'e2' }]));
    const user = userEvent.setup();
    renderWithRouter(<StudyPlan plan={PLAN} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /全部加入/ }));

    expect(addDeduped).toHaveBeenCalledTimes(1);
    expect(addDeduped).toHaveBeenCalledWith([
      expect.objectContaining({ summary: '複習單字' }),
      expect.objectContaining({ summary: '練習發音' }),
    ]);
    expect(await screen.findByText('成功加入行事曆!')).toBeInTheDocument();
  });

  test('寫入失敗時顯示錯誤訊息，不會顯示成功動畫', async () => {
    addDeduped.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();
    renderWithRouter(<StudyPlan plan={PLAN} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /全部加入/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('加入行事曆失敗');
    expect(screen.queryByText('成功加入行事曆!')).not.toBeInTheDocument();
  });

  test('全部加入完成後，按鈕會顯示「已全部加入」並停用，避免重複寫入', async () => {
    addDeduped.mockResolvedValue(ok([{ id: 'e1' }, { id: 'e2' }]));
    const user = userEvent.setup();
    renderWithRouter(<StudyPlan plan={PLAN} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /全部加入/ }));
    const button = await screen.findByRole('button', { name: '已全部加入' });

    expect(button).toBeDisabled();
  });

  test('開始追蹤：把加入行事曆時拿到的事件 id 一起帶進去，並通知父層', async () => {
    addDeduped.mockResolvedValue(ok([{ id: 'e1' }, { id: 'e2' }]));
    startTracking.mockResolvedValue({});
    const onTracked = vi.fn();
    const user = userEvent.setup();
    renderWithRouter(<StudyPlan plan={PLAN} onClose={vi.fn()} onTracked={onTracked} />);

    await user.click(screen.getByRole('button', { name: /全部加入/ }));
    await user.click(screen.getByRole('button', { name: '開始追蹤進度' }));

    expect(startTracking).toHaveBeenCalledWith(PLAN, { 0: 'e1', 1: 'e2' }, { replace: false });
    expect(onTracked).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: '已開始追蹤' })).toBeInTheDocument();
  });

  test('已經在追蹤別份、還有未完成任務：先行內確認，確認前不會取代', async () => {
    startTracking.mockRejectedValueOnce(new ExistingPlanError()).mockResolvedValue({});
    const user = userEvent.setup();
    renderWithRouter(<StudyPlan plan={PLAN} onClose={vi.fn()} onTracked={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '開始追蹤進度' }));
    await user.click(await screen.findByRole('button', { name: '取代並開始追蹤' }));
    expect(startTracking).toHaveBeenCalledTimes(2);
    expect(startTracking).toHaveBeenLastCalledWith(PLAN, {}, { replace: true });
  });

  test('開始追蹤失敗：提示錯誤，可以再試', async () => {
    startTracking.mockRejectedValue(new Error('x'));
    const user = userEvent.setup();
    renderWithRouter(<StudyPlan plan={PLAN} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '開始追蹤進度' }));
    expect(await screen.findByText('沒有開始追蹤成功，請稍後再試。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '開始追蹤進度' })).toBeInTheDocument();
  });

  // 稽核 FE4-09：還原對話後卡片的「已加入」狀態是空的，再按「全部加入」不能在行事曆產生重複行程
  test('還原後再按「全部加入」：已在行事曆的行程被略過，告知略過筆數，仍拿到既有行程的 id 供追蹤', async () => {
    addDeduped.mockResolvedValue(ok([{ id: 'old-1' }, { id: 'old-2' }], 2));
    startTracking.mockResolvedValue({});
    const user = userEvent.setup();
    renderWithRouter(<StudyPlan plan={PLAN} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /全部加入/ }));

    expect(await screen.findByText('其中 2 個行程已經在行事曆中，沒有重複加入。')).toBeInTheDocument();
    expect(screen.queryByText('成功加入行事曆!')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '已全部加入' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '開始追蹤進度' }));
    expect(startTracking).toHaveBeenCalledWith(PLAN, { 0: 'old-1', 1: 'old-2' }, { replace: false });
  });

  test('部分已存在：仍顯示成功動畫，並告知略過幾筆', async () => {
    addDeduped.mockResolvedValue(ok([{ id: 'old-1' }, { id: 'new-2' }], 1));
    const user = userEvent.setup();
    renderWithRouter(<StudyPlan plan={PLAN} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /全部加入/ }));

    expect(await screen.findByText('成功加入行事曆!')).toBeInTheDocument();
    expect(screen.getByText('其中 1 個行程已經在行事曆中，沒有重複加入。')).toBeInTheDocument();
  });

  test('單筆「加入」遇到已存在的行程：顯示已加入並說明沒有重複加入', async () => {
    addDeduped.mockResolvedValue(ok([{ id: 'old-1' }], 1));
    const user = userEvent.setup();
    renderWithRouter(<StudyPlan plan={PLAN} onClose={vi.fn()} />);

    await user.click(screen.getAllByRole('button', { name: /加入/ }).find((b) => b.className.includes('add-to-calendar-btn')));

    expect(await screen.findByText('這個行程已經在行事曆中，沒有重複加入。')).toBeInTheDocument();
    expect(screen.getByText('已加入')).toBeInTheDocument();
  });
});
