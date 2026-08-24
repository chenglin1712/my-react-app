import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UserCalendar from './calendar_date';
import { getCalendar, addCalendarEvent, deleteCalendarEvent } from '../../src/userServives/uploadDb';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../src/userServives/uploadDb', () => ({
  getCalendar: vi.fn(),
  addCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
}));

// react-calendar 本身的月曆邏輯不是這裡要測的重點，這幾個測試也都只用預設
// 選取日期（today），不需要真的操作月曆格子，這裡用一個最小的替身取代。
vi.mock('react-calendar', () => ({
  default: () => <div data-testid="calendar-stub" />,
}));

function todayKey() {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
}

describe('UserCalendar (calendar_date) — FR-3 補齊的行事曆持久化', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    getCalendar.mockReset();
    addCalendarEvent.mockReset();
    deleteCalendarEvent.mockReset();
    getCalendar.mockResolvedValue([]);
  });

  test('新增行程會呼叫 addCalendarEvent，成功後立刻顯示在畫面上（不用等重新整理）', async () => {
    addCalendarEvent.mockResolvedValueOnce({
      id: 'evt-1', summary: '看醫生', description: '',
      start: `${todayKey()}T00:00:00+08:00`, end: `${todayKey()}T00:30:00+08:00`,
    });
    render(<UserCalendar />);
    await waitFor(() => expect(getCalendar).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('新增事件'), { target: { value: '看醫生' } });
    fireEvent.click(screen.getByRole('button', { name: '新增' }));

    await waitFor(() => expect(screen.getByText('看醫生')).toBeInTheDocument());
    expect(addCalendarEvent).toHaveBeenCalledTimes(1);
  });

  test('新增失敗時顯示錯誤訊息，不會靜默失敗', async () => {
    addCalendarEvent.mockRejectedValueOnce(new Error('network down'));
    render(<UserCalendar />);
    await waitFor(() => expect(getCalendar).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('新增事件'), { target: { value: '看醫生' } });
    fireEvent.click(screen.getByRole('button', { name: '新增' }));

    await waitFor(() => expect(screen.getByText('新增行程失敗，請稍後再試。')).toBeInTheDocument());
  });

  test('空白事件不會呼叫 addCalendarEvent', async () => {
    render(<UserCalendar />);
    await waitFor(() => expect(getCalendar).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '新增' }));

    expect(addCalendarEvent).not.toHaveBeenCalled();
  });

  test('刪除行程依 id 呼叫 deleteCalendarEvent，成功後從畫面移除', async () => {
    getCalendar.mockResolvedValue([
      { id: 'evt-1', summary: '看醫生', description: '', start: `${todayKey()}T00:00:00+08:00`, end: `${todayKey()}T00:30:00+08:00` },
    ]);
    deleteCalendarEvent.mockResolvedValueOnce();

    render(<UserCalendar />);
    await waitFor(() => expect(screen.getByText('看醫生')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '刪除' }));

    await waitFor(() => expect(deleteCalendarEvent).toHaveBeenCalledWith('evt-1'));
    await waitFor(() => expect(screen.queryByText('看醫生')).not.toBeInTheDocument());
  });

  test('內容包含「測驗」字樣的事件會顯示前往測驗按鈕，點擊導向 /quiz/select', async () => {
    getCalendar.mockResolvedValue([
      { id: 'evt-1', summary: '準備測驗', description: '', start: `${todayKey()}T00:00:00+08:00`, end: `${todayKey()}T00:30:00+08:00` },
    ]);

    render(<UserCalendar />);
    await waitFor(() => expect(screen.getByText('準備測驗')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '前往測驗' }));
    expect(mockNavigate).toHaveBeenCalledWith('/quiz/select');
  });

  test('取得行事曆失敗時顯示錯誤訊息', async () => {
    getCalendar.mockRejectedValueOnce(new Error('permission denied'));
    render(<UserCalendar />);

    await waitFor(() => expect(screen.getByText('載入行事曆失敗，請稍後再試。')).toBeInTheDocument());
  });
});
