import { describe, test, expect } from 'vitest';
import { eventDateKey, groupEventsByDate } from './eventDateKey';

// 稽核 FE6-14：日期鍵改用台灣時間解析，不再取 start 字串「T 之前」的部分
describe('eventDateKey', () => {
  test('+08:00 的事件取當地日期（與原本行為相同）', () => {
    expect(eventDateKey({ start: '2026-10-23T09:00:00+08:00' })).toBe('2026-10-23');
    expect(eventDateKey({ start: '2026-10-23T00:00:00+08:00' })).toBe('2026-10-23');
  });

  test('Z 結尾的 UTC 時間換成台灣日期：UTC 10/23 18:00 是台灣 10/24 02:00', () => {
    expect(eventDateKey({ start: '2026-10-23T18:00:00Z' })).toBe('2026-10-24');
    expect(eventDateKey({ start: '2026-10-23T15:59:00Z' })).toBe('2026-10-23');
  });

  test('沒有時區的日期時間視為台灣本地時間，直接取 T 前面的日期（不受瀏覽器時區影響）', () => {
    expect(eventDateKey({ start: '2026-10-23T18:00:00' })).toBe('2026-10-23');
    expect(eventDateKey({ start: '2026-10-23T00:30' })).toBe('2026-10-23');
    expect(eventDateKey({ start: '2026-10-23T23:59:59.500' })).toBe('2026-10-23');
    expect(eventDateKey({ start: '2026-13-45T18:00:00' })).toBeNull();
  });

  test('有 offset 時仍以台灣時區換算：-05:00 的 10/23 12:00 是台灣 10/24 01:00', () => {
    expect(eventDateKey({ start: '2026-10-23T12:00:00-05:00' })).toBe('2026-10-24');
    expect(eventDateKey({ start: '2026-10-23T23:30:00+09:00' })).toBe('2026-10-23');
  });

  // 複驗：V8 的 Date.parse 會把不存在的日期自動進位，必須自己核對年月日
  test('不存在的日期一律回傳 null（只有日期、沒有時區、有時區三種寫法都一樣）', () => {
    expect(eventDateKey({ start: '2026-02-30T18:00:00' })).toBeNull();
    expect(eventDateKey({ start: '2026-04-31T10:00' })).toBeNull();
    expect(eventDateKey({ start: '2026-13-01' })).toBeNull();
    expect(eventDateKey({ start: '2026-13-45' })).toBeNull();
    expect(eventDateKey({ start: '2026-00-10' })).toBeNull();
    expect(eventDateKey({ start: '2026-02-30T18:00:00+08:00' })).toBeNull();
    expect(eventDateKey({ start: '2026-02-29' })).toBeNull();          // 2026 不是閏年
    expect(eventDateKey({ start: '2100-02-29T09:00:00' })).toBeNull(); // 整百年非閏年
  });

  // 第三輪複驗：只認嚴格 ISO，其他寫法不再交給寬鬆的 Date.parse
  test('前後空白先去掉；去掉後的日期仍要合法', () => {
    expect(eventDateKey({ start: ' 2026-10-23' })).toBe('2026-10-23');
    expect(eventDateKey({ start: '2026-10-23 ' })).toBe('2026-10-23');
    expect(eventDateKey({ start: '  2026-10-23T18:00:00Z  ' })).toBe('2026-10-24');
    expect(eventDateKey({ start: ' 2026-02-30' })).toBeNull();
    expect(eventDateKey({ start: '   ' })).toBeNull();
  });

  test('日期與時間用空格分隔也接受（沒有時區取日期；有時區換算）；日期不合法回 null', () => {
    expect(eventDateKey({ start: '2026-10-23 18:00:00' })).toBe('2026-10-23');
    expect(eventDateKey({ start: '2026-10-23 18:00:00Z' })).toBe('2026-10-24');
    expect(eventDateKey({ start: '2026-02-30 18:00:00' })).toBeNull();
  });

  test('斜線分隔不接受（專案資料來源都是 ISO），合法或不合法日期都回 null', () => {
    expect(eventDateKey({ start: '2026/10/23' })).toBeNull();
    expect(eventDateKey({ start: '2026/02/30' })).toBeNull();
    expect(eventDateKey({ start: '2026/10/23 18:00' })).toBeNull();
  });

  test('單位數月日不接受', () => {
    expect(eventDateKey({ start: '2026-1-5' })).toBeNull();
    expect(eventDateKey({ start: '2026-1-5T09:00:00+08:00' })).toBeNull();
    expect(eventDateKey({ start: '2026-01-5' })).toBeNull();
  });

  test('Z＋毫秒（含超過 3 位的小數）可換算；日期不合法回 null', () => {
    expect(eventDateKey({ start: '2026-10-23T18:00:00.123Z' })).toBe('2026-10-24');
    expect(eventDateKey({ start: '2026-10-23T15:59:59.999999Z' })).toBe('2026-10-23');
    expect(eventDateKey({ start: '2026-10-23T09:00:00.5+08:00' })).toBe('2026-10-23');
    expect(eventDateKey({ start: '2026-02-30T18:00:00.123Z' })).toBeNull();
  });

  test('時間或時區超出範圍回 null', () => {
    expect(eventDateKey({ start: '2026-10-23T24:00:00' })).toBeNull();
    expect(eventDateKey({ start: '2026-10-23T23:60' })).toBeNull();
    expect(eventDateKey({ start: '2026-10-23T09:00:00+15:00' })).toBeNull();
    expect(eventDateKey({ start: '2026-10-23T09:00:00+0800' })).toBeNull();
  });

  test('閏年 2/29 合法', () => {
    expect(eventDateKey({ start: '2028-02-29' })).toBe('2028-02-29');
    expect(eventDateKey({ start: '2028-02-29T09:00:00' })).toBe('2028-02-29');
    expect(eventDateKey({ start: '2000-02-29T09:00:00+08:00' })).toBe('2000-02-29');
    expect(eventDateKey({ start: '2026-04-30T10:00' })).toBe('2026-04-30');
  });

  test('不存在日期的行程在分組時被略過', () => {
    const bad = { start: '2026-02-30T18:00:00' };
    expect(groupEventsByDate([bad]).skipped).toEqual([bad]);
  });

  test('只有日期的字串直接當鍵', () => {
    expect(eventDateKey({ start: '2026-10-23' })).toBe('2026-10-23');
  });

  test('start 缺少、不是字串或無法解析時回傳 null', () => {
    expect(eventDateKey({})).toBeNull();
    expect(eventDateKey(null)).toBeNull();
    expect(eventDateKey({ start: 12345 })).toBeNull();
    expect(eventDateKey({ start: '' })).toBeNull();
    expect(eventDateKey({ start: 'not-a-date' })).toBeNull();
  });
});

describe('groupEventsByDate', () => {
  test('壞資料放進 skipped，不影響其他事件分組', () => {
    const good1 = { start: '2026-10-23T09:00:00+08:00' };
    const good2 = { start: '2026-10-23T18:00:00Z' };
    const bad = { start: undefined };
    const { grouped, skipped } = groupEventsByDate([good1, bad, good2, null]);
    expect(grouped).toEqual({ '2026-10-23': [good1], '2026-10-24': [good2] });
    expect(skipped).toEqual([bad, null]);
  });

  test('不是陣列時當成沒有事件', () => {
    expect(groupEventsByDate(undefined)).toEqual({ grouped: {}, skipped: [] });
  });
});
