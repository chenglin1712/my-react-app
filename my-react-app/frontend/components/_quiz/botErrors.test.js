import { describe, expect, test } from 'vitest';
import { describeChatError } from './botErrors';

const err = (status, data, extra = {}) => Object.assign(new Error('x'), { status, data, ...extra });

describe('describeChatError', () => {
  test.each([
    [err(429, { detail: '請求過於頻繁，請稍後再試' }), 'rate', true, '約一分鐘'],
    [err(503, { detail: 'AI 服務目前忙碌，請稍後再試' }), 'busy', true, '忙碌'],
    [err(504, { detail: 'AI 服務回應逾時，請稍後再試' }), 'timeout', true, '逾時'],
    [err(502, { detail: 'AI 服務暫時無法回應，請稍後再試' }), 'server', true, '暫時無法'],
    [err(undefined, undefined, { timedOut: true }), 'timeout', true, '太久'],
    [new Error('Network Error'), 'network', true, '連不上伺服器'],
    [err(401), 'auth', false, '重新登入'],
    [err(403), 'forbidden', false, '目前無法使用'],
    [err(400, { detail: '請求參數錯誤' }), 'rejected', false, '修改後再試'],
  ])('%#', (error, kind, retryable, text) => {
    const info = describeChatError(error);
    expect(info.kind).toBe(kind);
    expect(info.retryable).toBe(retryable);
    expect(info.text).toContain(text);
  });

  test('assistant switched off and daily quota are never retryable', () => {
    expect(describeChatError(err(403, { code: 'ai_assistant_disabled', detail: '維護中' }))).toMatchObject({ kind: 'service_off', retryable: false, text: '維護中' });
    expect(describeChatError(err(429, { code: 'ai_daily_quota_exceeded' }))).toMatchObject({ kind: 'quota', retryable: false });
  });

  test('image-specific errors only apply when an image was attached', () => {
    expect(describeChatError(err(400), { image: true }).kind).toBe('image_rejected');
    expect(describeChatError(err(400), { image: false }).kind).toBe('rejected');
    expect(describeChatError(err(403, { code: 'ai_image_input_disabled' }), { image: true }).kind).toBe('image_off');
  });

  test('an array detail from a validation error is never shown as text', () => {
    expect(describeChatError(err(502, { detail: [{ msg: 'bad' }] })).text).toBe('AI 服務暫時無法回應，請稍後再試。');
  });
});
