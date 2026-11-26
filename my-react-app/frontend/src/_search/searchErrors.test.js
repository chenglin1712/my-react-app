import { describe, test, expect } from 'vitest';
import { describeSearchError, SEARCH_ERROR_KIND, suggestUrl } from './searchErrors';

// 稽核 FE3-01：查詢失敗依原因給不同說明，不洩漏後端的內部訊息
describe('describeSearchError', () => {
  test('429：限流，請稍後再試，並說明登入後額度較多', () => {
    const e = describeSearchError({ status: 429, message: 'Rate limit exceeded: 30 per 1 minute' });
    expect(e.kind).toBe(SEARCH_ERROR_KIND.RATE_LIMITED);
    expect(e.message).toMatch(/稍候/);
    expect(e.message).toMatch(/登入/);
    expect(e.message).not.toMatch(/Rate limit/);
    expect(e.retryable).toBe(true);
  });

  test('401：登入失效，不給重試', () => {
    expect(describeSearchError({ status: 401 })).toMatchObject({ kind: SEARCH_ERROR_KIND.AUTH, retryable: false });
  });

  test('5xx、逾時、斷線：服務暫時無法使用，不顯示內部訊息', () => {
    for (const err of [{ status: 500, message: 'Traceback /srv/app.py' }, { status: 503 }, { timedOut: true }, new Error('Network Error')]) {
      const e = describeSearchError(err);
      expect(e.kind).toBe(SEARCH_ERROR_KIND.UNAVAILABLE);
      expect(e.message).toBe('辭典服務暫時無法使用，請稍後再試。');
    }
  });

  test('400／422：條件有誤', () => {
    expect(describeSearchError({ status: 422 }).kind).toBe(SEARCH_ERROR_KIND.INVALID);
  });

  test('載入更多的訊息開頭不同', () => {
    expect(describeSearchError({ status: 429 }, { action: 'loadMore' }).message).toMatch(/^載入更多/);
  });
});

test('稽核 FE3-04：建議端點跟關鍵字查詢同一層', () => {
  expect(suggestUrl()).toBe('/api/v1/dictionary/suggest/');
});
