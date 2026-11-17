import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  RECENT_SEARCHES_KEY, MAX_RECENT_SEARCHES,
  loadRecentSearches, addRecentSearch, removeRecentSearch, clearRecentSearches,
} from './recentSearches';

describe('recentSearches（P2-4）', () => {
  beforeEach(() => window.localStorage.clear());

  test('最新的在最前面，重複的併成一筆，空白不記', () => {
    addRecentSearch('babaw');
    addRecentSearch('  balay ');
    addRecentSearch('babaw');
    addRecentSearch('   ');
    expect(loadRecentSearches()).toEqual(['babaw', 'balay']);
  });

  test('最多保留固定筆數，最舊的先掉', () => {
    for (let i = 0; i < MAX_RECENT_SEARCHES + 3; i += 1) addRecentSearch(`w${i}`);
    const list = loadRecentSearches();
    expect(list).toHaveLength(MAX_RECENT_SEARCHES);
    expect(list[0]).toBe(`w${MAX_RECENT_SEARCHES + 2}`);
  });

  test('移除單筆與全部清除；清除後 localStorage 不留鍵', () => {
    addRecentSearch('a1');
    addRecentSearch('b2');
    expect(removeRecentSearch('a1')).toEqual(['b2']);
    expect(clearRecentSearches()).toEqual([]);
    expect(window.localStorage.getItem(RECENT_SEARCHES_KEY)).toBeNull();
  });

  test('內容被改壞（不是 JSON、不是陣列、混入非字串或過長）時當作沒有或只取合法的', () => {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, '{壞掉');
    expect(loadRecentSearches()).toEqual([]);
    window.localStorage.setItem(RECENT_SEARCHES_KEY, '{"a":1}');
    expect(loadRecentSearches()).toEqual([]);
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['ok', 5, null, 'x'.repeat(101), 'ok', '']));
    expect(loadRecentSearches()).toEqual(['ok']);
  });

  test('localStorage 讀寫丟錯（無痕、被關閉）時不丟例外', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => addRecentSearch('x')).not.toThrow();
    spy.mockRestore();
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(loadRecentSearches()).toEqual([]);
    get.mockRestore();
  });
});
