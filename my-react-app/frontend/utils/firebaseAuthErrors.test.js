import { describe, expect, test } from 'vitest';
import { authErrorMessage } from './firebaseAuthErrors';

describe('Firebase 錯誤碼對照', () => {
    test('常見錯誤顯示中文說明', () => {
        expect(authErrorMessage({ code: 'auth/network-request-failed' })).toContain('網路');
        expect(authErrorMessage({ code: 'auth/too-many-requests' })).toContain('稍後');
        expect(authErrorMessage({ code: 'auth/user-disabled' })).toContain('停用');
    });

    test('登入時「沒有這個帳號」與「密碼錯誤」顯示同樣的訊息，不洩漏帳號是否存在', () => {
        expect(authErrorMessage({ code: 'auth/user-not-found' })).toBe(authErrorMessage({ code: 'auth/wrong-password' }));
    });

    test('沒有對應的錯誤用呼叫端的通用訊息，不會把英文 message 顯示出來', () => {
        expect(authErrorMessage({ code: 'auth/unknown', message: 'Firebase: boom' }, '登入失敗')).toBe('登入失敗');
        expect(authErrorMessage(new TypeError('Failed to fetch'), '登入失敗')).toBe('登入失敗');
        expect(authErrorMessage(undefined)).toBe('發生未預期的錯誤，請稍後再試');
    });
});
