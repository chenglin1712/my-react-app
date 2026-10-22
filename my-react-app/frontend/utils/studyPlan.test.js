import { describe, test, expect } from 'vitest';
import { cleanTasks, mergeReplan, newTrackedPlan, progressOf, withTaskDone } from './studyPlan';

const task = (id, over = {}) => ({
  id, summary: `任務${id}`, description: '', done: false,
  start: '2026-10-23T09:00:00+08:00', end: '2026-10-23T10:00:00+08:00', ...over,
});
const event = (summary, start) => ({ summary, description: '', start, end: start.replace('09:00', '10:00') });

describe('newTrackedPlan', () => {
  test('每個活動變成未完成任務，序號對應的行事曆事件 id 會帶上', () => {
    const plan = newTrackedPlan(
      { title: '一週計畫', events: [event('A', '2026-10-23T09:00:00+08:00'), event('B', '2026-10-24T09:00:00+08:00')] },
      { 1: 'cal-b' },
    );
    expect(plan.title).toBe('一週計畫');
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks.every((t) => t.done === false && t.id)).toBe(true);
    expect(plan.tasks[0].calendarEventId).toBeUndefined();
    expect(plan.tasks[1].calendarEventId).toBe('cal-b');
  });

  test('缺少名稱或時間的活動丟掉，超過 14 筆截斷', () => {
    const many = Array.from({ length: 20 }, (_, i) => event(`T${i}`, '2026-10-23T09:00:00+08:00'));
    expect(newTrackedPlan({ events: many }).tasks).toHaveLength(14);
    expect(newTrackedPlan({ events: [{ summary: '', start: 'x', end: 'y' }, { summary: 'ok' }] }).tasks).toHaveLength(0);
  });
});

describe('cleanTasks', () => {
  test('壞掉、重複 id 的項目丟掉，done 只有 true 才算完成', () => {
    const tasks = cleanTasks([task('a', { done: 'yes' }), task('a'), { id: 'b' }, null, task('c', { done: true })]);
    expect(tasks.map((t) => t.id)).toEqual(['a', 'c']);
    expect(tasks.map((t) => t.done)).toEqual([false, true]);
  });
});

describe('progress', () => {
  test('完成數與比例', () => {
    expect(progressOf([task('a', { done: true }), task('b')])).toEqual({ done: 1, total: 2, undone: 1, ratio: 0.5 });
    expect(progressOf([]).ratio).toBe(0);
  });
  test('withTaskDone 只改指定的任務', () => {
    const next = withTaskDone([task('a'), task('b')], 'b', true);
    expect(next.map((t) => t.done)).toEqual([false, true]);
  });
});

describe('mergeReplan（重排不會動到已完成的任務）', () => {
  const current = [
    task('done1', { done: true, start: '2026-10-22T09:00:00+08:00' }),
    task('u1', { calendarEventId: 'cal-1' }),
    task('u2'),
  ];
  const result = {
    replaced_ids: ['u1', 'u2'],
    events: [event('新A', '2026-10-25T09:00:00+08:00'), event('新B', '2026-10-26T09:00:00+08:00')],
  };

  test('只換掉 replaced_ids，已完成的任務原封不動，並依時間排序', () => {
    const merged = mergeReplan(current, result);
    expect(merged.ok).toBe(true);
    expect(merged.tasks[0]).toEqual(current[0]);
    expect(merged.tasks.map((t) => t.summary)).toEqual(['任務done1', '新A', '新B']);
    expect(merged.removedCalendarEventIds).toEqual(['cal-1']);
    expect(merged.hadCalendarLink).toBe(true);
    expect(merged.freshIds).toHaveLength(2);
  });

  test('被取代的任務重排期間已被勾成完成：整個不套用', () => {
    const changed = current.map((t) => (t.id === 'u2' ? { ...t, done: true } : t));
    expect(mergeReplan(changed, result)).toEqual({ ok: false, reason: 'changed' });
  });

  test('被取代的任務不見了：不套用', () => {
    expect(mergeReplan(current.filter((t) => t.id !== 'u1'), result)).toEqual({ ok: false, reason: 'changed' });
  });

  test('筆數對不上或沒有 replaced_ids：不套用', () => {
    expect(mergeReplan(current, { ...result, events: result.events.slice(0, 1) }).reason).toBe('invalid');
    expect(mergeReplan(current, { events: result.events }).ok).toBe(false);
  });

  test('新時間壓到保留的已完成任務：不套用', () => {
    const clash = { replaced_ids: ['u1', 'u2'], events: [event('撞', '2026-10-22T09:00:00+08:00'), event('新B', '2026-10-26T09:00:00+08:00')] };
    expect(mergeReplan(current, clash)).toEqual({ ok: false, reason: 'overlap' });
  });

  test('保留的任務仍引用同一個行事曆事件時，不刪那個事件', () => {
    const shared = [task('k', { calendarEventId: 'evt' }), task('u1', { calendarEventId: 'evt', start: '2026-10-24T09:00:00+08:00', end: '2026-10-24T10:00:00+08:00' })];
    const merged = mergeReplan(shared, { replaced_ids: ['u1'], events: [event('新', '2026-10-27T09:00:00+08:00')] });
    expect(merged.ok).toBe(true);
    expect(merged.removedCalendarEventIds).toEqual([]);
    expect(merged.hadCalendarLink).toBe(true);
  });

  test('沒有行事曆關聯的任務重排後不需要碰行事曆', () => {
    const merged = mergeReplan([task('u2')], { replaced_ids: ['u2'], events: [event('新', '2026-10-25T09:00:00+08:00')] });
    expect(merged.hadCalendarLink).toBe(false);
    expect(merged.removedCalendarEventIds).toEqual([]);
  });
});
