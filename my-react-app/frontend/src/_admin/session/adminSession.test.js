import { afterEach, describe, expect, test, vi } from 'vitest';
import { ADMIN_SESSION_MAX_AGE_MS, clearAdminSession, hasAdminSession, markAdminSession } from './adminSession';

afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
});

describe('後台工作階段旗標', () => {
    test('沒有標記時不算數', () => {
        expect(hasAdminSession('u1')).toBe(false);
    });

    test('標記後同一個帳號算數，換帳號不算', () => {
        markAdminSession('u1');
        expect(hasAdminSession('u1')).toBe(true);
        expect(hasAdminSession('u2')).toBe(false);
    });

    test('沒有 uid 時不標記也不通過', () => {
        markAdminSession('');
        expect(window.sessionStorage.length).toBe(0);
        expect(hasAdminSession('')).toBe(false);
    });

    test('清除之後不算數', () => {
        markAdminSession('u1');
        clearAdminSession();
        expect(hasAdminSession('u1')).toBe(false);
    });

    test('超過壽命就不算數（旗標不會永遠有效）', () => {
        markAdminSession('u1');
        const { at } = JSON.parse(window.sessionStorage.getItem('yy-admin-session'));
        expect(hasAdminSession('u1', at + ADMIN_SESSION_MAX_AGE_MS)).toBe(true);
        expect(hasAdminSession('u1', at + ADMIN_SESSION_MAX_AGE_MS + 1)).toBe(false);
    });

    test('時間欄位缺漏、不是數字或在未來都不算數', () => {
        const key = 'yy-admin-session';
        window.sessionStorage.setItem(key, JSON.stringify({ uid: 'u1' }));
        expect(hasAdminSession('u1')).toBe(false);
        window.sessionStorage.setItem(key, JSON.stringify({ uid: 'u1', at: 'x' }));
        expect(hasAdminSession('u1')).toBe(false);
        window.sessionStorage.setItem(key, JSON.stringify({ uid: 'u1', at: Date.now() + 60_000 }));
        expect(hasAdminSession('u1')).toBe(false);
    });

    test('內容損毀時當作沒有旗標，不丟例外', () => {
        window.sessionStorage.setItem('yy-admin-session', '{壞掉的 json');
        expect(hasAdminSession('u1')).toBe(false);
    });

    test('sessionStorage 不能用時（隱私模式）當作沒有旗標，不丟例外', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
        expect(() => markAdminSession('u1')).not.toThrow();
        expect(hasAdminSession('u1')).toBe(false);
    });
});
