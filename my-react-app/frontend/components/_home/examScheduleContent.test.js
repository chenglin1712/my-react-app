import { describe, expect, test } from 'vitest';
import { formatMonthDay, parseDay, phaseStatus, pickExamSchedule } from './examScheduleContent';

describe('parseDay', () => {
  test('YYYY-MM-DD 解成當地時區那天，不會因時區差一天', () => {
    const d = parseDay('2026-10-12');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 12]);
  });
  test('帶時間的 ISO 只取日期；壞格式與非字串回 null', () => {
    expect(parseDay('2026-10-12T08:00:00Z').getDate()).toBe(12);
    expect(parseDay('10/12')).toBeNull();
    expect(parseDay(null)).toBeNull();
    expect(parseDay(20261012)).toBeNull();
  });
});

describe('pickExamSchedule', () => {
  test('依開始日排序；略過沒有名稱或日期壞掉的項目；結束日不晚於開始日就當作單日', () => {
    const out = pickExamSchedule({
      session: '115年度原住民族語言能力認證日程表',
      phases: [
        { phase: '測驗', start_date: '2026-11-08', end_date: '2026-11-08' },
        { phase: '報名', start_date: '2026-09-01', end_date: '2026-09-15' },
        { phase: '', start_date: '2026-09-02' },
        { phase: '壞日期', start_date: 'abc' },
        null,
      ],
    });
    expect(out.session).toBe('115年度原住民族語言能力認證');
    expect(out.phases.map((p) => p.phase)).toEqual(['報名', '測驗']);
    expect(out.phases[1].end).toBeNull();
    expect(out.phases[0].url).toMatch(/signup/);
    expect(out.phases[1].url).toBeNull();
  });
  test('資料不是預期的形狀回 null（讓首頁走錯誤狀態）；沒有屆次名稱給空字串', () => {
    expect(pickExamSchedule(null)).toBeNull();
    expect(pickExamSchedule({})).toBeNull();
    expect(pickExamSchedule({ phases: 'x' })).toBeNull();
    expect(pickExamSchedule({ phases: [] })).toEqual({ session: '', phases: [] });
  });
});

describe('phaseStatus', () => {
  const phase = { phase: '報名', start: new Date(2026, 8, 1), end: new Date(2026, 8, 15) };
  test('開始前是 upcoming 並算出天數；期間含頭尾是 current；之後是 past', () => {
    expect(phaseStatus(phase, new Date(2026, 7, 30, 23, 59))).toEqual({ state: 'upcoming', daysLeft: 2 });
    expect(phaseStatus(phase, new Date(2026, 8, 1, 0, 0)).state).toBe('current');
    expect(phaseStatus(phase, new Date(2026, 8, 15, 23, 59)).state).toBe('current');
    expect(phaseStatus(phase, new Date(2026, 8, 16, 0, 0)).state).toBe('past');
  });
  test('單日期程：當天是 current', () => {
    const one = { phase: '測驗', start: new Date(2026, 10, 8), end: null };
    expect(phaseStatus(one, new Date(2026, 10, 8, 12)).state).toBe('current');
    expect(phaseStatus(one, new Date(2026, 10, 9)).state).toBe('past');
  });
});

test('formatMonthDay：月/日不補零', () => {
  expect(formatMonthDay(new Date(2026, 8, 1))).toBe('9/1');
});
