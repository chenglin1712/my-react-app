import { describe, expect, test } from 'vitest';
import {
  findUnsyncedIds, hasDataImages, isBlankNote, NOTE_LIMITS, reconcile, validateForCloud,
} from './noteSyncCore';

const local = (id, overrides = {}) => ({ id, title: `標題${id}`, content: `<p>內容${id}</p>`, editedAt: 1000, ...overrides });
const cloud = (id, overrides = {}) => ({ id, title: `標題${id}`, content: `<p>內容${id}</p>`, editedAt: 1000, createdAtMs: 10, ...overrides });
const meta = (overrides = {}) => ({ synced: {}, pendingDeletes: [], failed: {}, ...overrides });
const NOW = 5000;

const run = (l, c, m) => reconcile({ local: l, cloud: c, meta: m, now: NOW });

describe('isBlankNote', () => {
  test('沒有標題、沒有文字、沒有圖片才算空白', () => {
    expect(isBlankNote({ id: 'a', title: '', content: '<p></p>' })).toBe(true);
    expect(isBlankNote({ id: 'a', title: '  ', content: '<p>&nbsp;</p>' })).toBe(true);
    expect(isBlankNote({ id: 'a', title: '', content: '' })).toBe(true);
    expect(isBlankNote({ id: 'a', title: '有標題', content: '<p></p>' })).toBe(false);
    expect(isBlankNote({ id: 'a', title: '', content: '<p>字</p>' })).toBe(false);
    expect(isBlankNote({ id: 'a', title: '', content: '<p><img src="https://x/y.png"></p>' })).toBe(false);
  });
});

describe('validateForCloud', () => {
  test('標題 100 字以內、內容 100 KB 以內才可以', () => {
    expect(validateForCloud({ title: '字'.repeat(100), content: '<p>x</p>' })).toBeNull();
    expect(validateForCloud({ title: '字'.repeat(101), content: '<p>x</p>' }).code).toBe('title_too_long');
  });

  test('中文每字 3 位元組：約 34,000 字就超過 100 KB，但字元數遠低於規則的字元上限', () => {
    const big = '字'.repeat(35000); // 105,000 位元組
    expect(big.length).toBeLessThan(NOTE_LIMITS.CONTENT_CHARS);
    expect(validateForCloud({ title: '', content: big }).code).toBe('content_too_large');
    expect(validateForCloud({ title: '', content: '字'.repeat(34000) })).toBeNull();
  });

  test('超過字元上限一律拒絕', () => {
    expect(validateForCloud({ title: '', content: 'a'.repeat(100001) }).code).toBe('content_too_large');
  });
});

describe('hasDataImages', () => {
  test('只在有內嵌 data:image 時回傳 true', () => {
    expect(hasDataImages('<p><img src="data:image/png;base64,AAAA"></p>')).toBe(true);
    expect(hasDataImages("<img alt='x' src='data:image/jpeg;base64,AAAA'>")).toBe(true);
    expect(hasDataImages('<img src="https://res.cloudinary.com/x.png">')).toBe(false);
    expect(hasDataImages('<p>data:image/png</p>')).toBe(false);
    expect(hasDataImages(undefined)).toBe(false);
  });
});

describe('findUnsyncedIds', () => {
  test('沒同步過、或編輯時間比同步時新的才算，空白頁不算', () => {
    const notes = [
      local('new'),
      local('same', { editedAt: 1000 }),
      local('edited', { editedAt: 2000 }),
      { id: 'blank', title: '', content: '<p></p>' },
    ];
    const m = meta({ synced: { same: 1000, edited: 1000 } });
    expect(findUnsyncedIds(notes, m)).toEqual(['new', 'edited']);
  });

  test('失敗過、之後沒再編輯的頁先略過；再編輯就重新嘗試', () => {
    const m = meta({ failed: { a: { code: 'unknown', editedAt: 1000 } } });
    expect(findUnsyncedIds([local('a', { editedAt: 1000 })], m)).toEqual([]);
    expect(findUnsyncedIds([local('a', { editedAt: 1001 })], m)).toEqual(['a']);
  });
});

describe('reconcile：首次同步（遷移）', () => {
  test('本機有、雲端沒有、從沒同步過：上傳；空白頁不上傳', () => {
    const r = run([local('a'), { id: 'b', title: '', content: '<p></p>' }], [], meta());
    expect(r.toPush).toEqual(['a']);
    expect(r.toDelete).toEqual([]);
    expect(r.changed).toBe(true); // 有其他筆記時，沒上傳過的空白頁被拿掉
    expect(r.local.map((n) => n.id)).toEqual(['a']);
  });

  test('只有一張預設空白頁時保留它，不上傳', () => {
    const blank = { id: 'b', title: '', content: '<p></p>' };
    const r = run([blank], [], meta());
    expect(r.toPush).toEqual([]);
    expect(r.local).toEqual([blank]);
    expect(r.changed).toBe(false);
  });

  test('雲端有、本機沒有：拉回本機，依建立時間排在後面', () => {
    const r = run([local('a')], [cloud('c2', { createdAtMs: 20 }), cloud('c1', { createdAtMs: 10 })], meta());
    expect(r.local.map((n) => n.id)).toEqual(['a', 'c1', 'c2']);
    expect(r.markSynced).toMatchObject({ c1: 1000, c2: 1000 });
    expect(r.changedIds).toEqual(['c1', 'c2']);
  });

  test('另一台裝置新增的頁拉進來時，這台沒用過的空白預設頁會被拿掉', () => {
    const blank = { id: 'b', title: '', content: '<p></p>' };
    const r = run([blank], [cloud('c1')], meta());
    expect(r.local.map((n) => n.id)).toEqual(['c1']);
  });
});

describe('reconcile：兩邊都有', () => {
  test('內容相同：記為已同步，不上傳，編輯時間對齊雲端', () => {
    const r = run([local('a', { editedAt: 900 })], [cloud('a', { editedAt: 1000 })], meta());
    expect(r.toPush).toEqual([]);
    expect(r.markSynced).toEqual({ a: 1000 });
    expect(r.local[0].editedAt).toBe(1000);
  });

  test('只有雲端變動：取雲端版本', () => {
    const r = run([local('a', { editedAt: 1000 })], [cloud('a', { title: '新標題', editedAt: 2000 })], meta({ synced: { a: 1000 } }));
    expect(r.local[0]).toMatchObject({ title: '新標題', editedAt: 2000 });
    expect(r.changedIds).toEqual(['a']);
    expect(r.toPush).toEqual([]);
    expect(r.notices).toEqual([]);
  });

  test('只有本機變動：上傳', () => {
    const r = run([local('a', { title: '改過', editedAt: 2000 })], [cloud('a', { editedAt: 1000 })], meta({ synced: { a: 1000 } }));
    expect(r.toPush).toEqual(['a']);
    expect(r.local[0].title).toBe('改過');
  });

  test('兩邊都改過、雲端較晚：用雲端版本並提示', () => {
    const r = run(
      [local('a', { title: '本機改', editedAt: 2000 })],
      [cloud('a', { title: '雲端改', editedAt: 3000 })],
      meta({ synced: { a: 1000 } }),
    );
    expect(r.local[0].title).toBe('雲端改');
    expect(r.toPush).toEqual([]);
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0]).toMatchObject({ kind: 'conflict-cloud-won', id: 'a' });
    expect(r.notices[0].message).toContain('較新的版本');
  });

  test('兩邊都改過、本機較晚：保留本機並上傳，提示', () => {
    const r = run(
      [local('a', { title: '本機改', editedAt: 4000 })],
      [cloud('a', { title: '雲端改', editedAt: 3000 })],
      meta({ synced: { a: 1000 } }),
    );
    expect(r.local[0].title).toBe('本機改');
    expect(r.toPush).toEqual(['a']);
    expect(r.notices[0].kind).toBe('conflict-local-won');
  });

  test('編輯時間完全相同但內容不同：雲端優先（兩個裝置都會收斂到同一份）', () => {
    const r = run(
      [local('a', { title: '本機', editedAt: 2000 })],
      [cloud('a', { title: '雲端', editedAt: 2000 })],
      meta({ synced: { a: 1000 } }),
    );
    expect(r.local[0].title).toBe('本機'); // 本機 2000 不小於雲端 2000
    expect(r.toPush).toEqual(['a']);
  });

  test('比同步紀錄更舊的雲端資料（延遲抵達的舊快照）不會蓋掉本機', () => {
    const r = run(
      [local('a', { title: '剛同步的新版', editedAt: 3000 })],
      [cloud('a', { title: '舊版', editedAt: 1000 })],
      meta({ synced: { a: 3000 } }),
    );
    expect(r.local[0].title).toBe('剛同步的新版');
    expect(r.changedIds).toEqual([]);
    expect(r.toPush).toEqual(['a']);
  });

  test('同步關閉期間改過內容（編輯時間沒動）：視為本機有修改並補上編輯時間', () => {
    const r = run(
      [local('a', { title: '離線改', editedAt: 1000 })],
      [cloud('a', { title: '舊', editedAt: 1000 })],
      meta({ synced: { a: 1000 } }),
    );
    expect(r.toPush).toEqual(['a']);
    expect(r.local[0].editedAt).toBe(NOW);
  });

  test('從沒同步過、兩邊內容不同（例如重新安裝後同一個 id）：比編輯時間，沒編輯時間的本機視為 0', () => {
    const r = run([{ id: 'a', title: '舊本機', content: '<p>x</p>' }], [cloud('a', { title: '雲端', editedAt: 2000 })], meta());
    expect(r.local[0].title).toBe('雲端');
    expect(r.notices[0].kind).toBe('conflict-cloud-won');
  });
});

describe('reconcile：刪除', () => {
  test('同步過、雲端沒有了、本機沒再改：被別的裝置刪除，本機也移除並提示', () => {
    const r = run([local('a'), local('b')], [cloud('b')], meta({ synced: { a: 1000, b: 1000 } }));
    expect(r.local.map((n) => n.id)).toEqual(['b']);
    expect(r.forgetSynced).toEqual(['a']);
    expect(r.notices[0]).toMatchObject({ kind: 'remote-deleted', id: 'a' });
  });

  test('同步過、雲端被刪、但本機之後又改過：保留並重新上傳', () => {
    const r = run([local('a', { editedAt: 2000 })], [], meta({ synced: { a: 1000 } }));
    expect(r.local.map((n) => n.id)).toEqual(['a']);
    expect(r.toPush).toEqual(['a']);
    expect(r.forgetSynced).toEqual(['a']);
    expect(r.notices[0].kind).toBe('kept-after-remote-delete');
  });

  test('使用者在這裡刪除（pendingDeletes）：從雲端刪除，不會被拉回來', () => {
    const r = run([local('b')], [cloud('a'), cloud('b')], meta({ synced: { a: 1000, b: 1000 }, pendingDeletes: ['a'] }));
    expect(r.toDelete).toEqual(['a']);
    expect(r.local.map((n) => n.id)).toEqual(['b']);
  });

  test('雲端已經沒有的 pendingDeletes 會被清掉', () => {
    const r = run([local('b')], [cloud('b')], meta({ synced: { b: 1000 }, pendingDeletes: ['gone'] }));
    expect(r.clearPending).toEqual(['gone']);
  });

  test('安全：本機筆記因為損毀被重置、同步紀錄還在時，雲端的頁是被拉回來，不是被當成刪除', () => {
    const r = run(
      [{ id: 'fresh', title: '', content: '<p></p>' }],
      [cloud('a'), cloud('b')],
      meta({ synced: { a: 1000, b: 1000 } }), // 沒有 pendingDeletes
    );
    expect(r.toDelete).toEqual([]);
    expect(r.local.map((n) => n.id)).toEqual(['a', 'b']);
  });
});

describe('Codex 審查後補的情境', () => {
  test('isBlankNote：分隔線、影片等非文字內容不算空白（避免被當成沒用過的空白頁清掉）', () => {
    expect(isBlankNote({ title: '', content: '<p></p>' })).toBe(true);
    expect(isBlankNote({ title: '', content: '<p><br></p>' })).toBe(true);
    expect(isBlankNote({ title: '', content: '<hr>' })).toBe(false);
    expect(isBlankNote({ title: '', content: '<p><video src="x.mp4"></video></p>' })).toBe(false);
    expect(isBlankNote({ title: '', content: '<iframe src="x"></iframe>' })).toBe(false);
  });

  test('兩邊內容相同：本機編輯時間不會被較舊的雲端快照往回改', () => {
    const local = [{ id: 'a', title: 'T', content: '<p>x</p>', editedAt: 500 }];
    const cloud = [{ id: 'a', title: 'T', content: '<p>x</p>', editedAt: 300, createdAtMs: 1 }];
    const out = reconcile({ local, cloud, meta: { synced: { a: 300 }, pendingDeletes: [] }, now: 1000 });
    expect(out.local[0].editedAt).toBe(500);
    expect(out.markSynced.a).toBe(500);
  });
});
