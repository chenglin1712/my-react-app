import { describe, test, expect, beforeEach, vi } from 'vitest';
import { getGuestId, GUEST_ID_HEADER } from './guestId';

const VALID = /^[A-Za-z0-9_-]{16,64}$/;

describe('getGuestId', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  test('第一次產生符合後端格式的代號，之後同一個瀏覽器拿到同一個', () => {
    const first = getGuestId();
    expect(first).toMatch(VALID);
    expect(getGuestId()).toBe(first);
    expect(window.localStorage.getItem('yy_guest_id')).toBe(first);
  });

  test('儲存的值格式不對（被竄改或舊資料）會換成新的合法代號', () => {
    window.localStorage.setItem('yy_guest_id', 'bad id!');
    expect(getGuestId()).toMatch(VALID);
  });

  test('localStorage 不可用時退回記憶體代號，同一頁面期間保持一致、不拋例外', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const id = getGuestId();
    expect(id).toMatch(VALID);
    expect(getGuestId()).toBe(id);
  });

  test('標頭名稱和後端一致', () => {
    expect(GUEST_ID_HEADER).toBe('X-Guest-Id');
  });
});
