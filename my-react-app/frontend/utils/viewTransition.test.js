import { describe, test, expect, vi, afterEach } from 'vitest';
import { withSharedTransition } from './viewTransition';

afterEach(() => {
  delete document.startViewTransition;
  vi.restoreAllMocks();
});

describe('withSharedTransition（P1-3）', () => {
  test('不支援 View Transitions 時直接執行更新', () => {
    const update = vi.fn();
    expect(withSharedTransition(update, { name: 'x', source: document.createElement('div') })).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
  });

  test('鍵盤觸發一律直接執行，不轉場', () => {
    document.startViewTransition = vi.fn();
    const update = vi.fn();
    withSharedTransition(update, { name: 'x', trigger: 'keyboard' });
    expect(document.startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  test('減少動態偏好時直接執行', () => {
    document.startViewTransition = vi.fn();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    const update = vi.fn();
    withSharedTransition(update, { name: 'x' });
    expect(document.startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  test('有支援時：來源元素暫時掛上名稱，結束後還原', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    let resolve;
    const finished = new Promise((r) => { resolve = r; });
    document.startViewTransition = vi.fn((cb) => { cb(); return { finished, ready: Promise.resolve() }; });
    const el = document.createElement('div');
    const update = vi.fn();
    withSharedTransition(update, { name: 'word-detail', source: el });
    expect(el.style.viewTransitionName).toBe('word-detail');
    expect(update).toHaveBeenCalledTimes(1);
    resolve();
    await finished;
    await Promise.resolve();
    expect(el.style.viewTransitionName).toBe('');
  });

  test('startViewTransition 丟錯時退回直接更新', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    document.startViewTransition = vi.fn(() => { throw new Error('boom'); });
    const update = vi.fn();
    withSharedTransition(update, { name: 'x', source: document.createElement('div') });
    expect(update).toHaveBeenCalledTimes(1);
  });
});
