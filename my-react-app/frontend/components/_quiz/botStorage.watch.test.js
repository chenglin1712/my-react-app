import { describe, test, expect, vi, beforeEach } from 'vitest';

const fb = vi.hoisted(() => ({ listener: null, unsubscribe: vi.fn(), throwOnWatch: false }));
vi.mock('../../../firebase', () => ({ auth: { currentUser: { uid: 'fallback-uid' } } }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth, cb) => {
    if (fb.throwOnWatch) throw new Error('no auth');
    fb.listener = cb;
    return fb.unsubscribe;
  },
}));

const { watchUid } = await import('./botStorage');
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('watchUid', () => {
  beforeEach(() => { fb.listener = null; fb.throwOnWatch = false; fb.unsubscribe.mockReset(); });

  test('reports login, account switch and logout in order', async () => {
    const seen = [];
    watchUid((uid) => seen.push(uid));
    await settle();
    fb.listener({ uid: 'a' }); fb.listener({ uid: 'b' }); fb.listener(null);
    expect(seen).toEqual(['a', 'b', null]);
  });

  test('stopping unsubscribes and silences later events', async () => {
    const seen = [];
    const stop = watchUid((uid) => seen.push(uid));
    await settle();
    stop();
    fb.listener?.({ uid: 'late' });
    expect(fb.unsubscribe).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
  });

  test('stopping before the listener is attached reports nothing', async () => {
    const seen = [];
    watchUid((uid) => seen.push(uid))();
    await settle();
    fb.listener?.({ uid: 'late' });
    expect(seen).toEqual([]);
  });

  test('falls back to reading the current uid once when watching is impossible', async () => {
    fb.throwOnWatch = true;
    const seen = [];
    watchUid((uid) => seen.push(uid));
    await settle();
    expect(seen).toEqual(['fallback-uid']);
  });
});
