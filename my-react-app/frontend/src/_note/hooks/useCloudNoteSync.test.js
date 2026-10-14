import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMemo, useRef, useState } from 'react';
import { useCloudNoteSync } from './useCloudNoteSync';
import { metaKey } from '../sync/noteSyncMeta';

vi.mock('@utils/uploadToCloudinary', () => ({ uploadToCloudinary: vi.fn() }));

const UID = 'u1';
const DB = {}; // 真實環境的 Firestore 連線是固定的一個物件，不能每次 render 都換新的
const NOW = 1_760_000_000_000;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const note = (id, overrides = {}) => ({ id, title: `標題${id}`, content: `<p>內容${id}</p>`, editedAt: NOW - 10_000, ...overrides });

function makeRepo() {
  const repo = {
    cloud: new Map(),
    emit: null,
    emitError: null,
    subscribeNotes: vi.fn((db, uid, callback, onError) => {
      repo.emit = (extra = {}) => callback({
        notes: [...repo.cloud.values()], fromCache: false, hasPendingWrites: false, ...extra,
      });
      repo.emitError = onError;
      return () => {};
    }),
    saveNote: vi.fn(async (db, uid, n) => {
      repo.cloud.set(n.id, { ...n, createdAtMs: 1 });
      return { created: true };
    }),
    deleteNote: vi.fn(async (db, uid, id) => {
      repo.cloud.delete(id);
      return { deleted: true };
    }),
    readNoteFromServer: vi.fn(async (db, uid, id) => repo.cloud.get(id) || null),
    classifyError: (err) => err?.kind || 'unknown',
  };
  return repo;
}

/** 假的筆記頁：筆記狀態＋同步需要的幾個函式，行為對齊 useNotePages（persist 同步更新 ref）。 */
function useHarness({ repo, upload, initial, enabled = true, uid = UID }) {
  const [notes, setNotes] = useState(initial);
  const ref = useRef(initial);
  const listeners = useRef(new Set());
  const api = useMemo(() => ({
    getNotes: () => ref.current,
    flushEditor: () => ref.current,
    applyExternalChange: (updater) => {
      const prev = ref.current;
      const next = updater(prev);
      if (next === prev) return prev;
      ref.current = next;
      setNotes(next);
      return next;
    },
    subscribeEdit: (listener) => { listeners.current.add(listener); return () => listeners.current.delete(listener); },
    edit: (id, patch) => {
      ref.current = ref.current.map((n) => (n.id === id ? { ...n, ...patch } : n));
      setNotes(ref.current);
      listeners.current.forEach((fn) => fn());
    },
  }), []);
  const sync = useCloudNoteSync({
    uid, enabled, db: DB, notes, ...api, repo, upload, now: () => NOW, debounceMs: 2000,
  });
  return { notes, sync, api };
}

const tick = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

async function setup({ initial, cloud = [], upload = vi.fn(async () => 'https://res.cloudinary.com/new.png'), enabled = true, uid = UID, metaSeed } = {}) {
  if (metaSeed) localStorage.setItem(metaKey(UID), JSON.stringify(metaSeed));
  const repo = makeRepo();
  cloud.forEach((c) => repo.cloud.set(c.id, { createdAtMs: 1, ...c }));
  const view = renderHook(() => useHarness({ repo, upload, initial, enabled, uid }));
  return { repo, upload, view, get: () => view.result.current };
}

async function connect(ctx) {
  act(() => { ctx.repo.emit(); });
  await tick(0);
}

describe('useCloudNoteSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('旗標關閉或訪客：完全不連雲端，狀態是 off', async () => {
    const off = await setup({ initial: [note('a')], enabled: false });
    expect(off.get().sync.status).toBe('off');
    expect(off.repo.subscribeNotes).not.toHaveBeenCalled();

    const guest = await setup({ initial: [note('a')], uid: 'guest' });
    expect(guest.get().sync.status).toBe('off');
    expect(guest.repo.subscribeNotes).not.toHaveBeenCalled();
  });

  test('開啟後先連線，收到第一份雲端資料才開始同步', async () => {
    const ctx = await setup({ initial: [note('a')] });
    expect(ctx.get().sync.status).toBe('connecting');
    expect(ctx.repo.saveNote).not.toHaveBeenCalled();
    await connect(ctx);
    expect(ctx.repo.saveNote).toHaveBeenCalledTimes(1);
    expect(ctx.get().sync.status).toBe('synced');
  });

  test('首次同步（D-3）：本機舊筆記一頁一頁上傳，空白頁不上傳，同步紀錄寫進 localStorage', async () => {
    const blank = { id: 'blank', title: '', content: '<p></p>' };
    const ctx = await setup({ initial: [note('a'), note('b'), blank] });
    await connect(ctx);

    expect(ctx.repo.saveNote.mock.calls.map(([, , n]) => n.id)).toEqual(['a', 'b']);
    expect(ctx.get().notes.map((n) => n.id)).toEqual(['a', 'b']); // 沒上傳過的空白頁被拿掉
    const meta = JSON.parse(localStorage.getItem(metaKey(UID)));
    expect(meta.synced).toEqual({ a: NOW - 10_000, b: NOW - 10_000 });
    expect(meta.migrated).toBe(true);
  });

  test('沒有編輯時間的舊筆記：上傳前補上並存回本機，之後固定不變', async () => {
    const legacy = { id: 'old', title: '舊的', content: '<p>舊內容</p>' };
    const ctx = await setup({ initial: [legacy] });
    await connect(ctx);
    expect(ctx.repo.saveNote.mock.calls[0][2].editedAt).toBe(NOW);
    expect(ctx.get().notes[0].editedAt).toBe(NOW);
  });

  test('雲端有、本機沒有的頁會合併進來', async () => {
    const ctx = await setup({
      initial: [note('a')],
      cloud: [{ id: 'c1', title: '別台寫的', content: '<p>x</p>', editedAt: NOW - 5000 }],
    });
    await connect(ctx);
    expect(ctx.get().notes.map((n) => n.id)).toEqual(['a', 'c1']);
  });

  test('兩個裝置改同一頁，雲端較晚：用雲端版本並提示', async () => {
    const ctx = await setup({
      initial: [note('a', { title: '本機改', editedAt: NOW - 5000 })],
      cloud: [{ id: 'a', title: '雲端改', content: '<p>內容a</p>', editedAt: NOW - 1000 }],
      metaSeed: { v: 1, synced: { a: NOW - 10_000 }, pendingDeletes: [], failed: {}, migrated: true },
    });
    await connect(ctx);
    expect(ctx.get().notes[0].title).toBe('雲端改');
    expect(ctx.get().sync.notices).toHaveLength(1);
    expect(ctx.get().sync.notices[0].message).toContain('較新的版本');
    expect(ctx.repo.saveNote).not.toHaveBeenCalled();

    act(() => ctx.get().sync.dismissNotice(ctx.get().sync.notices[0].key));
    expect(ctx.get().sync.notices).toHaveLength(0);
  });

  test('停止輸入 2 秒後才寫上雲端；中途又輸入會重新計時', async () => {
    const ctx = await setup({ initial: [note('a')], metaSeed: { v: 1, synced: { a: NOW - 10_000 }, pendingDeletes: [], failed: {}, migrated: true }, cloud: [{ id: 'a', title: '標題a', content: '<p>內容a</p>', editedAt: NOW - 10_000 }] });
    await connect(ctx);
    expect(ctx.repo.saveNote).not.toHaveBeenCalled();

    act(() => ctx.get().api.edit('a', { content: '<p>第一次</p>', editedAt: NOW }));
    await tick(1500);
    act(() => ctx.get().api.edit('a', { content: '<p>第二次</p>', editedAt: NOW + 1 }));
    await tick(1500);
    expect(ctx.repo.saveNote).not.toHaveBeenCalled();
    await tick(600);
    expect(ctx.repo.saveNote).toHaveBeenCalledTimes(1);
    expect(ctx.repo.saveNote.mock.calls[0][2]).toMatchObject({ id: 'a', content: '<p>第二次</p>', editedAt: NOW + 1 });
  });

  test('離開頁面（pagehide）立刻寫，不等 2 秒', async () => {
    const ctx = await setup({ initial: [note('a')], metaSeed: { v: 1, synced: { a: NOW - 10_000 }, pendingDeletes: [], failed: {}, migrated: true }, cloud: [{ id: 'a', title: '標題a', content: '<p>內容a</p>', editedAt: NOW - 10_000 }] });
    await connect(ctx);
    act(() => ctx.get().api.edit('a', { title: '改標題', editedAt: NOW }));
    await act(async () => { window.dispatchEvent(new Event('pagehide')); await vi.advanceTimersByTimeAsync(0); });
    expect(ctx.repo.saveNote).toHaveBeenCalledTimes(1);
  });

  test('網路中斷：狀態變離線，之後自動重試成功', async () => {
    const ctx = await setup({ initial: [note('a')] });
    ctx.repo.saveNote.mockRejectedValueOnce({ kind: 'network' });
    await connect(ctx);
    expect(ctx.get().sync.status).toBe('offline');
    expect(ctx.get().sync.failures).toEqual([]); // 網路問題不算這一頁失敗
    await tick(5000);
    expect(ctx.repo.saveNote).toHaveBeenCalledTimes(2);
    expect(ctx.get().sync.status).toBe('synced');
  });

  test('單頁寫入被雲端拒絕（例如裝置時鐘太快、規則未更新）：只標示那一頁失敗，其他頁照常同步，不會一直重試', async () => {
    const ctx = await setup({ initial: [note('a'), note('b')] });
    ctx.repo.saveNote.mockImplementation(async (db, uid, n) => {
      if (n.id === 'a') throw { kind: 'permission' };
      ctx.repo.cloud.set(n.id, { ...n, createdAtMs: 1 });
      return { created: true };
    });
    await connect(ctx);
    expect(ctx.get().sync.status).toBe('synced');
    expect(ctx.get().sync.failures).toEqual([expect.objectContaining({ id: 'a', code: 'permission' })]);
    expect(ctx.repo.cloud.has('b')).toBe(true);
    await tick(120_000);
    expect(ctx.repo.saveNote.mock.calls.filter(([, , n]) => n.id === 'a')).toHaveLength(1);
    expect(ctx.get().notes[0].title).toBe('標題a'); // 本機資料不受影響
  });

  test('訂閱本身被拒絕（沒有權限讀）：狀態是 error', async () => {
    const ctx = await setup({ initial: [note('a')] });
    await tick(0);
    act(() => { ctx.repo.emitError({ kind: 'permission' }); });
    expect(ctx.get().sync.status).toBe('error');
  });

  test('雲端已有更晚編輯的版本（舊裝置晚送出）：不覆蓋，改成取雲端較新的版本', async () => {
    const ctx = await setup({
      initial: [note('a', { title: '舊裝置的', editedAt: NOW - 50_000 })],
      metaSeed: { synced: {}, pendingDeletes: [], failed: {}, migrated: false },
    });
    const newer = { id: 'a', title: '別台較新的', content: '<p>新</p>', editedAt: NOW - 1000, createdAtMs: 1 };
    ctx.repo.saveNote.mockImplementationOnce(async () => {
      ctx.repo.cloud.set('a', newer);
      return { created: false, stale: true, cloud: newer };
    });
    await connect(ctx);
    await tick(10);
    expect(ctx.repo.cloud.get('a').title).toBe('別台較新的');
    expect(ctx.get().notes[0]).toMatchObject({ title: '別台較新的', editedAt: NOW - 1000 });
  });

  test('第一次上傳到一半使用者刪掉那一頁：雲端剛建立的那份會補刪，不會被當成別台新增的拉回來', async () => {
    const ctx = await setup({ initial: [note('a'), note('b')] });
    let release;
    ctx.repo.saveNote.mockImplementationOnce((db, uid, n) => new Promise((resolve) => {
      release = () => { ctx.repo.cloud.set(n.id, { ...n, createdAtMs: 1 }); resolve({ created: true }); };
    }));
    await connect(ctx);
    // a 正在上傳；使用者此時刪除 a（本機移除 + 通知同步）
    act(() => {
      ctx.get().api.applyExternalChange((prev) => prev.filter((n) => n.id !== 'a'));
      ctx.get().sync.recordDelete('a');
    });
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0); });
    await tick(5000);
    expect(ctx.repo.deleteNote).toHaveBeenCalledWith(expect.anything(), UID, 'a');
    expect(ctx.repo.cloud.has('a')).toBe(false);
    expect(ctx.get().notes.map((n) => n.id)).not.toContain('a');
  });

  test('同步進行中旗標被關掉：舊的一輪放棄，之後不再寫雲端、不再改本機', async () => {
    const view = { enabled: true };
    const repo = makeRepo();
    let release;
    repo.saveNote.mockImplementation((db, uid, n) => new Promise((resolve) => {
      release = () => { repo.cloud.set(n.id, { ...n, createdAtMs: 1 }); resolve({ created: true }); };
    }));
    const rendered = renderHook((props) => useHarness({ repo, upload: vi.fn(), initial: [note('a'), note('b')], ...props }), {
      initialProps: { enabled: true },
    });
    await tick(0);
    act(() => { repo.emit(); });
    await tick(0);
    expect(repo.saveNote).toHaveBeenCalledTimes(1); // 卡在第一頁
    rendered.rerender({ enabled: false });
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(5000); });
    expect(repo.saveNote).toHaveBeenCalledTimes(1); // b 沒有被送出
    expect(rendered.result.current.sync.status).toBe('off');
    view.enabled = false;
  });

  test('同步進行中換了帳號：舊帳號的一輪放棄，不會把資料寫到新帳號底下', async () => {
    const repo = makeRepo();
    let release;
    repo.saveNote.mockImplementation((db, uid) => new Promise((resolve) => {
      release = () => resolve({ created: true });
      repo.lastUid = uid;
    }));
    const rendered = renderHook((props) => useHarness({ repo, upload: vi.fn(), initial: [note('a'), note('b')], ...props }), {
      initialProps: { uid: 'userA' },
    });
    await tick(0);
    act(() => { repo.emit(); });
    await tick(0);
    expect(repo.saveNote).toHaveBeenCalledTimes(1);
    expect(repo.saveNote.mock.calls[0][1]).toBe('userA');
    rendered.rerender({ uid: 'userB' });
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0); });
    // 只有舊帳號那一次呼叫；b 頁不會被送到任何帳號
    expect(repo.saveNote.mock.calls.every(([, uid]) => uid === 'userA')).toBe(true);
    expect(JSON.parse(localStorage.getItem(metaKey('userB')) || '{"synced":{}}').synced).toEqual({});
  });

  test('超過大小上限的頁：不上傳、標示失敗，其他頁照常同步', async () => {
    const huge = note('big', { content: `<p>${'字'.repeat(35000)}</p>` });
    const ctx = await setup({ initial: [huge, note('ok')] });
    await connect(ctx);
    expect(ctx.repo.saveNote.mock.calls.map(([, , n]) => n.id)).toEqual(['ok']);
    expect(ctx.get().sync.failures).toEqual([expect.objectContaining({ id: 'big', code: 'content_too_large' })]);
    expect(ctx.get().notes.find((n) => n.id === 'big').content).toBe(huge.content);
    const meta = JSON.parse(localStorage.getItem(metaKey(UID)));
    expect(meta.migrated).toBe(false); // 有失敗的頁，遷移還沒算完成
  });

  test('超過 200 頁：該頁標示失敗但保留在本機', async () => {
    const ctx = await setup({ initial: [note('a')] });
    ctx.repo.saveNote.mockRejectedValue({ kind: 'limit' });
    await connect(ctx);
    expect(ctx.get().sync.failures[0]).toMatchObject({ id: 'a', code: 'limit' });
  });

  test('失敗過的頁不會一直重試，使用者按重試才會再試一次', async () => {
    const ctx = await setup({ initial: [note('a')] });
    ctx.repo.saveNote.mockRejectedValueOnce({ kind: 'unknown' });
    await connect(ctx);
    expect(ctx.get().sync.failures).toHaveLength(1);
    await tick(10_000);
    expect(ctx.repo.saveNote).toHaveBeenCalledTimes(1);

    act(() => ctx.get().sync.retry('a'));
    await tick(0);
    expect(ctx.repo.saveNote).toHaveBeenCalledTimes(2);
    expect(ctx.get().sync.failures).toEqual([]);
  });

  describe('Base64 圖片轉換（D-3）', () => {
    const withImage = () => note('img', { content: `<p>圖</p><img src="${PNG}">` });

    test('先轉成網址再寫上雲端；從伺服器讀回確認後，才把本機副本換成網址版本', async () => {
      const original = withImage();
      const ctx = await setup({ initial: [original] });
      let localWhileSaving;
      ctx.repo.saveNote.mockImplementation(async (db, uid, n) => {
        localWhileSaving = ctx.get().api.getNotes()[0].content;
        ctx.repo.cloud.set(n.id, { ...n, createdAtMs: 1 });
        return { created: true };
      });
      await connect(ctx);

      const saved = ctx.repo.saveNote.mock.calls[0][2];
      expect(saved.content).toContain('https://res.cloudinary.com/new.png');
      expect(saved.content).not.toContain('data:image');
      expect(localWhileSaving).toBe(original.content); // 寫入當下本機副本原封不動
      expect(ctx.repo.readNoteFromServer).toHaveBeenCalledTimes(1);
      expect(ctx.get().notes[0].content).toBe(saved.content); // 驗證後才換掉
      expect(ctx.get().sync.failures).toEqual([]);
    });

    test('圖片上傳失敗（例如斷網）：整頁不寫雲端，本機保留 Base64 並標示，可重試', async () => {
      const original = withImage();
      const upload = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue('https://res.cloudinary.com/ok.png');
      const ctx = await setup({ initial: [original], upload });
      await connect(ctx);

      expect(ctx.repo.saveNote).not.toHaveBeenCalled();
      expect(ctx.get().notes[0].content).toBe(original.content);
      expect(ctx.get().sync.failures[0]).toMatchObject({ id: 'img', code: 'image_upload' });

      act(() => ctx.get().sync.retry('img'));
      await tick(0);
      expect(ctx.repo.saveNote).toHaveBeenCalledTimes(1);
      expect(ctx.get().notes[0].content).toContain('https://res.cloudinary.com/ok.png');
      expect(ctx.get().sync.failures).toEqual([]);
    });

    test('寫入後從伺服器讀回來的內容對不上：不換掉本機副本，標示驗證失敗', async () => {
      const original = withImage();
      const ctx = await setup({ initial: [original] });
      ctx.repo.readNoteFromServer.mockResolvedValue({ id: 'img', title: '標題img', content: '<p>別的內容</p>', editedAt: 1 });
      await connect(ctx);
      expect(ctx.get().notes[0].content).toBe(original.content);
      expect(ctx.get().sync.failures[0]).toMatchObject({ code: 'verify' });
    });

    test('轉換的當下使用者又改了這一頁：不覆蓋使用者的新內容', async () => {
      const original = withImage();
      const ctx = await setup({ initial: [original] });
      ctx.repo.saveNote.mockImplementation(async (db, uid, n) => {
        ctx.get().api.edit('img', { content: '<p>使用者剛打的新內容</p>', editedAt: NOW + 5 });
        ctx.repo.cloud.set(n.id, { ...n, createdAtMs: 1 });
        return { created: true };
      });
      await connect(ctx);
      expect(ctx.get().notes[0].content).toBe('<p>使用者剛打的新內容</p>');
    });

    test('同一張圖出現在多頁只上傳一次', async () => {
      const ctx = await setup({ initial: [withImage(), note('img2', { content: `<img src="${PNG}">` })] });
      await connect(ctx);
      expect(ctx.upload).toHaveBeenCalledTimes(1);
      expect(ctx.repo.saveNote).toHaveBeenCalledTimes(2);
    });
  });

  describe('刪除', () => {
    const synced = (ids) => ({ v: 1, synced: Object.fromEntries(ids.map((id) => [id, NOW - 10_000])), pendingDeletes: [], failed: {}, migrated: true });

    test('在這裡刪除同步過的頁：2 秒後從雲端刪除，不會又被拉回來', async () => {
      const ctx = await setup({
        initial: [note('a'), note('b')],
        cloud: [note('a'), note('b')],
        metaSeed: synced(['a', 'b']),
      });
      await connect(ctx);
      act(() => {
        ctx.get().api.applyExternalChange((prev) => prev.filter((n) => n.id !== 'a'));
        ctx.get().sync.recordDelete('a');
      });
      expect(ctx.repo.deleteNote).not.toHaveBeenCalled();
      await tick(2000);
      expect(ctx.repo.deleteNote).toHaveBeenCalledWith(DB, UID, 'a');
      act(() => { ctx.repo.emit(); });
      await tick(0);
      expect(ctx.get().notes.map((n) => n.id)).toEqual(['b']);
    });

    test('從沒同步過的頁被刪除：雲端本來就沒有，不呼叫刪除', async () => {
      const ctx = await setup({ initial: [note('a')] });
      await connect(ctx);
      act(() => ctx.get().sync.recordDelete('never-synced'));
      await tick(3000);
      expect(ctx.repo.deleteNote).not.toHaveBeenCalled();
    });

    test('別的裝置刪除了這一頁：這裡也移除並提示', async () => {
      const ctx = await setup({ initial: [note('a'), note('b')], cloud: [note('b')], metaSeed: synced(['a', 'b']) });
      await connect(ctx);
      expect(ctx.get().notes.map((n) => n.id)).toEqual(['b']);
      expect(ctx.get().sync.notices[0].message).toContain('已在另一個裝置刪除');
    });

    test('快取資料（fromCache，例如離線）不能當成「被刪除」：本機筆記完全不動', async () => {
      const ctx = await setup({ initial: [note('a'), note('b')], metaSeed: synced(['a', 'b']) });
      act(() => { ctx.repo.emit({ notes: [], fromCache: true }); });
      await tick(0);
      expect(ctx.get().notes.map((n) => n.id)).toEqual(['a', 'b']);
      expect(ctx.get().sync.status).toBe('offline');
      expect(ctx.repo.deleteNote).not.toHaveBeenCalled();
    });

    test('自己剛寫、伺服器還沒確認的快照（hasPendingWrites）先不處理', async () => {
      const ctx = await setup({ initial: [note('a')], metaSeed: synced(['a']) });
      act(() => { ctx.repo.emit({ notes: [], hasPendingWrites: true }); });
      await tick(0);
      expect(ctx.get().notes.map((n) => n.id)).toEqual(['a']);
      expect(ctx.get().sync.status).toBe('connecting');
    });
  });
});
