import { describe, test, expect, beforeEach, vi } from 'vitest';
import { PROGRESS_KEY, currentStreak, dayKey, hasAnyProgress, readProgress, recordGameResult } from './gameProgress';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h);

describe('gameProgress（P4-1：只存在本機瀏覽器的個人進度）', () => {
  beforeEach(() => { localStorage.clear(); });

  test('沒有紀錄時是空的，hasAnyProgress 為 false', () => {
    const p = readProgress();
    expect(p).toEqual({ games: {}, days: [] });
    expect(hasAnyProgress(p)).toBe(false);
  });

  test('記錄一局：最高分只增不減，最近的族語與時間更新', () => {
    recordGameResult('listening', { tribe: 'amis', pct: 80, now: at(2026, 11, 17) });
    recordGameResult('listening', { tribe: 'bunun', pct: 60, now: at(2026, 11, 18) });
    const g = readProgress().games.listening;
    expect(g.best).toBe(80);
    expect(g.lastTribe).toBe('bunun');
    expect(g.lastAt).toBe(at(2026, 11, 18).getTime());
    expect(readProgress().days).toEqual(['2026-11-17', '2026-11-18']);
  });

  test('分數會夾在 0–100；不是數字就不記錄', () => {
    recordGameResult('sentence', { pct: 140, now: at(2026, 11, 18) });
    expect(readProgress().games.sentence.best).toBe(100);
    recordGameResult('vocabulary', { pct: NaN });
    recordGameResult('', { pct: 50 });
    expect(readProgress().games.vocabulary).toBeUndefined();
  });

  test('壞掉的資料（不是 JSON、欄位型別不對）不會丟錯，視為沒有紀錄', () => {
    localStorage.setItem(PROGRESS_KEY, '{oops');
    expect(readProgress()).toEqual({ games: {}, days: [] });
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ games: { listening: { best: 'x', lastAt: {} } }, days: ['bad', '2026-11-18'] }));
    const p = readProgress();
    expect(p.games.listening).toEqual({ best: null, lastTribe: null, lastAt: null });
    expect(p.days).toEqual(['2026-11-18']);
  });

  test('寫不進 localStorage（無痕模式）時靜默略過', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => recordGameResult('listening', { pct: 50 })).not.toThrow();
    spy.mockRestore();
  });

  test('連續天數：今天或昨天有玩才算；中間斷一天就重算', () => {
    const days = ['2026-11-14', '2026-11-16', '2026-11-17', '2026-11-18'];
    expect(currentStreak(days, at(2026, 11, 18))).toBe(3);
    expect(currentStreak(['2026-11-16', '2026-11-17'], at(2026, 11, 18))).toBe(2);   // 今天還沒玩，從昨天算
    expect(currentStreak(['2026-11-15'], at(2026, 11, 18))).toBe(0);                 // 前天以前就斷了
    expect(currentStreak([], at(2026, 11, 18))).toBe(0);
  });

  test('日期用本地時間，不是 UTC', () => {
    expect(dayKey(new Date(2026, 10, 18, 23, 30))).toBe('2026-11-18');
  });
});
