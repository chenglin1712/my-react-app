import { describe, test, expect } from 'vitest';
import { countChars, formatApiError, isAborted, isOutcomeUnknown } from './apiErrors';

describe('formatApiError', () => {
  test('把欄位錯誤攤平成一句，優先於通用的 message', () => {
    const err = Object.assign(new Error('請求參數錯誤'), { data: { errors: { title: ['太長'], link_url: ['格式不對'] } } });
    expect(formatApiError(err)).toBe('太長；格式不對');
  });

  test('巢狀物件與清單遞迴處理，不會輸出 [object Object]', () => {
    const err = Object.assign(new Error('x'), { data: { errors: { payload: { title: ['A'], items: [{ 0: ['B'] }] } } } });
    expect(formatApiError(err)).toBe('A；B');
  });

  test('沒有欄位錯誤時用 message，再沒有就用預設文字', () => {
    expect(formatApiError(new Error('伺服器錯誤'))).toBe('伺服器錯誤');
    expect(formatApiError({})).toBe('操作失敗，請稍後再試');
  });
});

describe('helpers', () => {
  test('沒有 status 或逾時視為結果不確定；取消另外判斷', () => {
    expect(isOutcomeUnknown({ name: 'ApiError', timedOut: true })).toBe(true);
    expect(isOutcomeUnknown({ name: 'ApiError', status: undefined })).toBe(true);
    expect(isOutcomeUnknown({ name: 'ApiError', status: 400 })).toBe(false);
    // 程式本身的例外不是「結果不確定」
    expect(isOutcomeUnknown(new TypeError('x is not a function'))).toBe(false);
    expect(isAborted({ code: 'ERR_CANCELED' })).toBe(true);
    expect(isAborted({ status: 400 })).toBe(false);
  });

  test('字數以 code point 計', () => {
    expect(countChars('族語')).toBe(2);
    expect(countChars('😀a')).toBe(2);
    expect(countChars(undefined)).toBe(0);
  });
});
