import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockAuth = vi.hoisted(() => ({}));
vi.mock('../../firebase', () => ({ auth: mockAuth }));

import { AUTH_READY_TIMEOUT_MS, waitForAuthReady } from './authReady';

describe('waitForAuthReady（重新整理時先等 Firebase 還原登入狀態，請求才帶得到憑證）', () => {
  beforeEach(() => { delete mockAuth.authStateReady; });
  afterEach(() => { vi.useRealTimers(); });

  test('等到 authStateReady 完成才回來', async () => {
    let finish;
    mockAuth.authStateReady = () => new Promise((resolve) => { finish = resolve; });
    let done = false;
    const pending = waitForAuthReady().then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    await pending;
    expect(done).toBe(true);
  });

  test('環境沒有 authStateReady（測試替身）就直接略過', async () => {
    await expect(waitForAuthReady()).resolves.toBeUndefined();
  });

  test('還原卡住時，到時間就放行，不讓請求永遠等', async () => {
    vi.useFakeTimers();
    mockAuth.authStateReady = () => new Promise(() => {});
    let done = false;
    const pending = waitForAuthReady().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(AUTH_READY_TIMEOUT_MS + 1);
    await pending;
    expect(done).toBe(true);
  });

  test('還原丟出錯誤也當作沒登入，不往外丟', async () => {
    mockAuth.authStateReady = () => Promise.reject(new Error('idb blocked'));
    await expect(waitForAuthReady()).resolves.toBeUndefined();
  });

  test('authStateReady 同步丟錯也不往外丟', async () => {
    mockAuth.authStateReady = () => { throw new Error('boom'); };
    await expect(waitForAuthReady()).resolves.toBeUndefined();
  });
});
