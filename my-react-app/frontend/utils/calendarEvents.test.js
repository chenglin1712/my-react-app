import { describe, test, expect } from 'vitest';
import {
  buildEventRange,
  formatEventTime,
  getEventType,
  isAllDayEvent,
  normalizeCalendarEvent,
} from './calendarEvents';

describe('isAllDayEvent', () => {
  test('明確的 allDay 欄位優先：選了 00:00 的非全天事件不會被當成全天', () => {
    expect(isAllDayEvent({ allDay: false, start: '2026-10-14T00:00:00+08:00' })).toBe(false);
    expect(isAllDayEvent({ allDay: true, start: '2026-10-14T09:00:00+08:00' })).toBe(true);
  });

  test('舊事件沒有 allDay：00:00 或只有日期視為全天，其餘不是', () => {
    expect(isAllDayEvent({ start: '2026-10-14T00:00:00+08:00' })).toBe(true);
    expect(isAllDayEvent({ start: '2026-10-14' })).toBe(true);
    expect(isAllDayEvent({ start: '2026-10-14T14:30:00+08:00' })).toBe(false);
  });

  test('舊事件以台灣時間判斷：UTC 16:00 就是台灣隔天 00:00', () => {
    expect(isAllDayEvent({ start: '2026-10-13T16:00:00Z' })).toBe(true);
  });

  test('沒有開始時間或格式壞掉不是全天', () => {
    expect(isAllDayEvent({})).toBe(false);
    expect(isAllDayEvent({ start: 'not-a-date' })).toBe(false);
  });
});

describe('getEventType', () => {
  test('明確的 type 優先：行程名稱含「測驗」但標成一般行程，就不是測驗', () => {
    expect(getEventType({ type: 'general', summary: '測驗心得分享' })).toBe('general');
    expect(getEventType({ type: 'quiz', summary: '複習' })).toBe('quiz');
  });

  test('舊事件沒有 type：沿用文字含「測驗」的猜法', () => {
    expect(getEventType({ summary: '準備測驗' })).toBe('quiz');
    expect(getEventType({ summary: '看醫生', description: '飯後測驗血糖' })).toBe('quiz');
    expect(getEventType({ summary: '看醫生' })).toBe('general');
  });

  test('未知的 type 當成沒有，回到文字判斷', () => {
    expect(getEventType({ type: 'weird', summary: '看醫生' })).toBe('general');
  });
});

describe('buildEventRange', () => {
  test('沒填時間是全天：當天 00:00 到隔天 00:00', () => {
    expect(buildEventRange('2026-10-14', '')).toEqual({
      start: '2026-10-14T00:00:00+08:00',
      end: '2026-10-15T00:00:00+08:00',
      allDay: true,
    });
  });

  test('全天跨月、跨年也正確', () => {
    expect(buildEventRange('2026-12-31', '').end).toBe('2027-01-01T00:00:00+08:00');
    expect(buildEventRange('2026-02-28', '').end).toBe('2026-03-01T00:00:00+08:00');
  });

  test('有填時間：開始後 30 分鐘，不是全天，真的選 00:00 也不是全天', () => {
    expect(buildEventRange('2026-10-14', '09:15')).toEqual({
      start: '2026-10-14T09:15:00+08:00',
      end: '2026-10-14T09:45:00+08:00',
      allDay: false,
    });
    expect(buildEventRange('2026-10-14', '00:00').allDay).toBe(false);
  });

  test('接近午夜會跨到隔天', () => {
    expect(buildEventRange('2026-10-14', '23:45').end).toBe('2026-10-15T00:15:00+08:00');
  });
});

describe('formatEventTime', () => {
  test('全天顯示「全天」；有時間顯示 HH:mm - HH:mm（台灣時區）', () => {
    expect(formatEventTime({ allDay: true, start: '2026-10-14T00:00:00+08:00' })).toBe('全天');
    expect(formatEventTime({ allDay: false, start: '2026-10-14T00:00:00+08:00', end: '2026-10-14T00:30:00+08:00' })).toBe('00:00 - 00:30');
    expect(formatEventTime({ start: '2026-10-14T14:30:00+08:00', end: '2026-10-14T15:00:00+08:00' })).toBe('14:30 - 15:00');
  });

  test('沒有結束時間只顯示開始；開始壞掉回空字串', () => {
    expect(formatEventTime({ start: '2026-10-14T14:30:00+08:00' })).toBe('14:30');
    expect(formatEventTime({ start: 'x' })).toBe('');
  });
});

describe('normalizeCalendarEvent', () => {
  test('補齊 allDay 與 type，不動其他欄位', () => {
    const out = normalizeCalendarEvent({ summary: '準備測驗', description: '', start: '2026-10-14T00:00:00+08:00', end: '2026-10-14T00:30:00+08:00' });
    expect(out).toMatchObject({ summary: '準備測驗', allDay: true, type: 'quiz' });
  });

  test('呼叫端明確給的值不會被覆蓋', () => {
    const out = normalizeCalendarEvent({ summary: '測驗', type: 'general', allDay: false, start: '2026-10-14T00:00:00+08:00' });
    expect(out).toMatchObject({ allDay: false, type: 'general' });
  });
});
