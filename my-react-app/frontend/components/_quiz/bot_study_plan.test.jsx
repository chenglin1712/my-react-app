import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import StudyPlan from './bot_study_plan';
import { addCalendarEvent, addCalendarEvents } from '../../src/userServives/uploadDb';

/** 原本這裡有一份完全沒被讀取/顯示/存起來的本地 events state，「加入」「全部
 * 加入」實際上什麼都沒發生，卻在「全部加入」之後顯示「成功加入行事曆!」的
 * 動畫——使用者被騙以為存成功了。這裡驗證兩個按鈕都真的呼叫了 Firestore
 * 寫入函式，而不是只改本地 state。 */
vi.mock('../../src/userServives/uploadDb', () => ({
  addCalendarEvent: vi.fn(),
  addCalendarEvents: vi.fn(),
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
    addCalendarEvent.mockReset();
    addCalendarEvents.mockReset();
  });

  test('沒有題目資料時不渲染任何內容', () => {
    const { container } = renderWithRouter(<StudyPlan plan={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('點擊單一事件的「加入」會真的呼叫 addCalendarEvent，成功後顯示「已加入」', async () => {
    addCalendarEvent.mockResolvedValue({ id: 'e1' });
    const user = userEvent.setup();
    renderWithRouter(<StudyPlan plan={PLAN} onClose={vi.fn()} />);

    await user.click(screen.getAllByRole('button', { name: /加入/ }).find((b) => b.className.includes('add-to-calendar-btn')));

    expect(addCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({ summary: '複習單字' }));
    expect(await screen.findByText('已加入')).toBeInTheDocument();
  });

  test('點擊「全部加入」只呼叫一次 addCalendarEvents（批次寫入），不是對每筆各自呼叫（回歸測試：原本用 Promise.all 平行呼叫 addCalendarEvent 會互相覆蓋遺失更新）', async () => {
    addCalendarEvents.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);
    const user = userEvent.setup();
    renderWithRouter(<StudyPlan plan={PLAN} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /全部加入/ }));

    expect(addCalendarEvents).toHaveBeenCalledTimes(1);
    expect(addCalendarEvents).toHaveBeenCalledWith([
      expect.objectContaining({ summary: '複習單字' }),
      expect.objectContaining({ summary: '練習發音' }),
    ]);
    expect(addCalendarEvent).not.toHaveBeenCalled();
    expect(await screen.findByText('成功加入行事曆!')).toBeInTheDocument();
  });

  test('寫入失敗時顯示錯誤訊息，不會顯示成功動畫', async () => {
    addCalendarEvents.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();
    renderWithRouter(<StudyPlan plan={PLAN} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /全部加入/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('加入行事曆失敗');
    expect(screen.queryByText('成功加入行事曆!')).not.toBeInTheDocument();
  });

  test('全部加入完成後，按鈕會顯示「已全部加入」並停用，避免重複寫入', async () => {
    addCalendarEvents.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);
    const user = userEvent.setup();
    renderWithRouter(<StudyPlan plan={PLAN} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /全部加入/ }));
    const button = await screen.findByRole('button', { name: '已全部加入' });

    expect(button).toBeDisabled();
  });
});
