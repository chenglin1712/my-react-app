import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UserCalendar from './calendar_date';
import { getCalendar, addCalendarEvent, deleteCalendarEvent } from '../../src/userServives/uploadDb';

const mockNavigate = vi.fn();
const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock('@components/ui/ConfirmDialog', () => ({ confirmAction: confirmMock }));

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
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
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

    fireEvent.click(screen.getByRole('button', { name: '刪除「看醫生」' }));

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

describe('UserCalendar 時間、刪除確認與載入狀態（E-7，P2-65、P2-66）', () => {
  beforeEach(() => {
    getCalendar.mockReset();
    addCalendarEvent.mockReset();
    deleteCalendarEvent.mockReset();
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
  });

  test('00:00 開始的事件顯示「全天」，有時間的顯示 HH:mm 而不是 00:00:00', async () => {
    getCalendar.mockResolvedValue([
      { id: 'a', summary: '全天的事', description: '', start: `${todayKey()}T00:00:00+08:00`, end: `${todayKey()}T00:30:00+08:00` },
      { id: 'b', summary: '下午的事', description: '', start: `${todayKey()}T14:30:00+08:00`, end: `${todayKey()}T15:00:00+08:00` },
    ]);
    render(<UserCalendar />);
    await screen.findByText('全天的事');
    expect(screen.getByText('全天')).toBeInTheDocument();
    expect(screen.queryByText(/00:00:00/)).not.toBeInTheDocument();
    expect(screen.getByText(/14:30/)).toBeInTheDocument();
  });

  test('標題用中文日期，不是 ISO 日期；頁面有 h1', async () => {
    getCalendar.mockResolvedValue([]);
    render(<UserCalendar />);
    expect(screen.getByRole('heading', { level: 1, name: '行事曆' })).toBeInTheDocument();
    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2.textContent).toMatch(/月.*日/);
    expect(h2.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    await waitFor(() => expect(getCalendar).toHaveBeenCalled());
  });

  test('可以選時間新增事件：開始時間帶入，不選就是 00:00', async () => {
    getCalendar.mockResolvedValue([]);
    addCalendarEvent.mockImplementation(async (e) => ({ id: 'n', description: '', ...e }));
    render(<UserCalendar />);
    await waitFor(() => expect(getCalendar).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('新增事件'), { target: { value: '看醫生' } });
    fireEvent.change(screen.getByLabelText('時間（不填就是全天）'), { target: { value: '09:15' } });
    fireEvent.click(screen.getByRole('button', { name: '新增' }));

    await waitFor(() => expect(addCalendarEvent).toHaveBeenCalledTimes(1));
    const sent = addCalendarEvent.mock.calls[0][0];
    expect(sent.start).toBe(`${todayKey()}T09:15:00+08:00`);
    expect(sent.end).toBe(`${todayKey()}T09:45:00+08:00`);
    expect(sent.allDay).toBe(false);
  });

  test('不填時間就是全天：送出 allDay=true，且結束在隔天 00:00', async () => {
    getCalendar.mockResolvedValue([]);
    addCalendarEvent.mockImplementation(async (e) => ({ id: 'n', description: '', ...e }));
    render(<UserCalendar />);
    await waitFor(() => expect(getCalendar).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('新增事件'), { target: { value: '生日' } });
    fireEvent.click(screen.getByRole('button', { name: '新增' }));

    await waitFor(() => expect(addCalendarEvent).toHaveBeenCalledTimes(1));
    const sent = addCalendarEvent.mock.calls[0][0];
    expect(sent.allDay).toBe(true);
    expect(sent.start).toBe(`${todayKey()}T00:00:00+08:00`);
    expect(sent.end).toMatch(/T00:00:00\+08:00$/);
    expect(sent.end).not.toBe(sent.start);
  });

  test('真的選 00:00 的事件顯示時間而不是「全天」（有明確 allDay 欄位時）', async () => {
    getCalendar.mockResolvedValue([
      { id: 'z', summary: '午夜開會', description: '', allDay: false, type: 'general', start: `${todayKey()}T00:00:00+08:00`, end: `${todayKey()}T00:30:00+08:00` },
    ]);
    render(<UserCalendar />);
    await screen.findByText('午夜開會');
    expect(screen.getByText('00:00 - 00:30')).toBeInTheDocument();
    expect(screen.queryByText('全天')).not.toBeInTheDocument();
  });

  test('「前往測驗」看事件類型：標成一般行程的事件即使名稱含「測驗」也沒有按鈕', async () => {
    getCalendar.mockResolvedValue([
      { id: 'q', summary: '準備複習', description: '', allDay: true, type: 'quiz', start: `${todayKey()}T00:00:00+08:00`, end: `${todayKey()}T00:30:00+08:00` },
      { id: 'g', summary: '測驗心得分享', description: '', allDay: true, type: 'general', start: `${todayKey()}T00:00:00+08:00`, end: `${todayKey()}T00:30:00+08:00` },
    ]);
    render(<UserCalendar />);
    await screen.findByText('準備複習');
    expect(screen.getAllByRole('button', { name: '前往測驗' })).toHaveLength(1);
  });

  test('可以把新事件標成「測驗提醒」，送出 type=quiz', async () => {
    getCalendar.mockResolvedValue([]);
    addCalendarEvent.mockImplementation(async (e) => ({ id: 'n', description: '', ...e }));
    render(<UserCalendar />);
    await waitFor(() => expect(getCalendar).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('新增事件'), { target: { value: '模擬考' } });
    fireEvent.change(screen.getByLabelText('事件類型'), { target: { value: 'quiz' } });
    fireEvent.click(screen.getByRole('button', { name: '新增' }));

    await waitFor(() => expect(addCalendarEvent).toHaveBeenCalledTimes(1));
    expect(addCalendarEvent.mock.calls[0][0].type).toBe('quiz');
    expect(await screen.findByRole('button', { name: '前往測驗' })).toBeInTheDocument();
  });

  test('刪除前會確認；選保留就不刪', async () => {
    getCalendar.mockResolvedValue([
      { id: 'evt-1', summary: '看醫生', description: '', start: `${todayKey()}T00:00:00+08:00`, end: `${todayKey()}T00:30:00+08:00` },
    ]);
    confirmMock.mockResolvedValue(false);
    render(<UserCalendar />);
    await screen.findByText('看醫生');

    fireEvent.click(screen.getByRole('button', { name: '刪除「看醫生」' }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(confirmMock.mock.calls[0][0].title).toBe('刪除這個行程？');
    expect(deleteCalendarEvent).not.toHaveBeenCalled();
    expect(screen.getByText('看醫生')).toBeInTheDocument();
  });

  test('載入期間顯示「載入行程中…」，載完才顯示「尚無紀錄」', async () => {
    let resolveEvents;
    getCalendar.mockImplementation(() => new Promise((resolve) => { resolveEvents = resolve; }));
    render(<UserCalendar />);
    expect(screen.getByRole('status')).toHaveTextContent('載入行程中');
    expect(screen.queryByText('尚無紀錄')).not.toBeInTheDocument();

    resolveEvents([]);
    expect(await screen.findByText('尚無紀錄')).toBeInTheDocument();
    expect(screen.queryByText('載入行程中…')).not.toBeInTheDocument();
  });
});
