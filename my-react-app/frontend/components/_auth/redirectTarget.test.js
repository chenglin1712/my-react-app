import { describe, test, expect } from 'vitest';
import { safeRedirectPath, withNext } from './redirectTarget';

const ORIGIN = 'https://yuanyu.test';

describe('登入後導回的路徑驗證（稽核 FE1-08）', () => {
  test.each([
    [null, '/'],
    ['', '/'],
    ['/admin', '/admin'],
    ['/admin/users?page=2#list', '/admin/users?page=2#list'],
    ['/quiz/select', '/quiz/select'],
    [`${ORIGIN}/note`, '/note'],
    // 開放重導向的各種變形
    ['//evil.example.com', '/'],
    ['/\\evil.example.com', '/'],
    ['\\\\evil.example.com', '/'],
    ['https://evil.example.com/admin', '/'],
    ['javascript:alert(1)', '/'],
    ['data:text/html,hi', '/'],
    ['\t//evil.example.com', '/'],
    // 同源但正規化後 pathname 變成 //evil.example.com（點路徑段）
    ['/.//evil.example.com', '/'],
    ['/..//evil.example.com', '/'],
    ['/./..//evil.example.com/x?y=1', '/'],
    ['/%2e//evil.example.com', '/'],
    ['/a/..//evil.example.com', '/'],
    // 導回登入／註冊頁本身沒有意義
    ['/login?next=/admin', '/'],
    ['/register', '/'],
    ['/login/', '/'],
    ['/LOGIN', '/'],
    ['/Register/?x=1', '/'],
    ['/admin-login', '/'],
    ['/admin-login/?next=/admin', '/'],
    ['/Admin-Login', '/'],
    ['/login//', '/'],
    // 不同路徑不能誤擋
    ['/loginhelp', '/loginhelp'],
    ['/login-help/faq', '/login-help/faq'],
    ['/admin-login-old', '/admin-login-old'],
    ['/registered', '/registered'],
    ['/admin', '/admin'],
  ])('next=%j → %s', (next, expected) => {
    expect(safeRedirectPath(next, ORIGIN)).toBe(expected);
  });

  test('withNext：首頁不必帶 next，其他路徑編碼後帶上', () => {
    expect(withNext('/login', '/')).toBe('/login');
    expect(withNext('/login', '')).toBe('/login');
    expect(withNext('/login', '/quiz/amis?x=1&y=2')).toBe(`/login?next=${encodeURIComponent('/quiz/amis?x=1&y=2')}`);
  });
});
