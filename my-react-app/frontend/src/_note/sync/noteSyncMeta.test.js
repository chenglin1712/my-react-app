import { beforeEach, describe, expect, test, vi } from 'vitest';
import { emptyMeta, loadMeta, metaKey, saveMeta } from './noteSyncMeta';

describe('noteSyncMeta', () => {
  beforeEach(() => localStorage.clear());

  test('沒有紀錄時回傳空的預設值', () => {
    expect(loadMeta('u1')).toEqual(emptyMeta());
  });

  test('存起來再讀回來；不同帳號互不影響', () => {
    saveMeta('u1', { ...emptyMeta(), synced: { a: 5 }, pendingDeletes: ['b'], migrated: true });
    expect(loadMeta('u1')).toMatchObject({ synced: { a: 5 }, pendingDeletes: ['b'], migrated: true });
    expect(loadMeta('u2')).toEqual(emptyMeta());
  });

  test('內容損毀（不是 JSON、不是物件、欄位型別錯）一律退回預設值，不丟錯', () => {
    localStorage.setItem(metaKey('u1'), '{壞掉');
    expect(loadMeta('u1')).toEqual(emptyMeta());
    localStorage.setItem(metaKey('u1'), '[]');
    expect(loadMeta('u1')).toEqual(emptyMeta());
    localStorage.setItem(metaKey('u1'), JSON.stringify({ synced: 'x', pendingDeletes: [1, 'ok'], failed: [], migrated: 'yes' }));
    expect(loadMeta('u1')).toEqual({ ...emptyMeta(), pendingDeletes: ['ok'] });
  });

  test('儲存空間滿了寫不進去時不丟錯，回傳 false', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(saveMeta('u1', emptyMeta())).toBe(false);
    spy.mockRestore();
    consoleSpy.mockRestore();
  });
});
