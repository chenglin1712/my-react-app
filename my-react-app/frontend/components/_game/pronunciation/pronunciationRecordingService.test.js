import { beforeEach, describe, expect, test, vi } from 'vitest';

const calls = [];

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...args) => ({ kind: 'collection', args })),
  addDoc: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: [] })),
  query: vi.fn((...args) => ({ kind: 'query', args })),
  where: vi.fn((...args) => ({ kind: 'where', args })),
  orderBy: vi.fn((...args) => ({ kind: 'orderBy', args })),
  limit: vi.fn((n) => ({ kind: 'limit', n })),
  doc: vi.fn((...args) => ({ kind: 'doc', args })),
  deleteDoc: vi.fn(async () => { calls.push('deleteDoc'); }),
  serverTimestamp: vi.fn(() => 'ts'),
}));

const deleteObject = vi.fn();
vi.mock('firebase/storage', () => ({
  ref: vi.fn((_storage, url) => ({ url })),
  deleteObject: (...args) => deleteObject(...args),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
}));

vi.mock('../../../../firebase', () => ({
  db: { name: 'mock-db' },
  getStorageInstance: vi.fn(async () => ({ name: 'mock-storage' })),
}));

import { query, where, deleteDoc } from 'firebase/firestore';
import { fetchReferenceUrls, deleteOwnRecording } from './pronunciationRecordingService';

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  deleteObject.mockImplementation(async () => { calls.push('deleteObject'); });
});

describe('fetchReferenceUrls', () => {
  // 稽核 BE5-01：score 是使用者自己帶的，只有後端核准（approved）的錄音才能當參考音
  test('只查 approved == true 的錄音，並維持分數門檻', async () => {
    await fetchReferenceUrls('tayal', 'huzil');
    const clauses = query.mock.calls[0].slice(1).filter((c) => c.kind === 'where').map((c) => c.args);
    expect(clauses).toContainEqual(['word', '==', 'huzil']);
    expect(clauses).toContainEqual(['approved', '==', true]);
    expect(clauses.some(([field, op]) => field === 'score' && op === '>=')).toBe(true);
    expect(where).toHaveBeenCalled();
  });
});

describe('deleteOwnRecording（撤回分享，稽核 FE5-05）', () => {
  const url = 'https://firebasestorage.googleapis.com/v0/b/x/o/pronunciations%2Ftayal%2Fhuzil%2Fa_alice.webm?alt=media';

  test('先刪 Storage 物件，再刪 Firestore 文件', async () => {
    await deleteOwnRecording('tayal', 'r1', url);
    expect(calls).toEqual(['deleteObject', 'deleteDoc']);
  });

  test('物件已經不存在（object-not-found）時，仍然刪掉 Firestore 文件', async () => {
    deleteObject.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'storage/object-not-found' }));
    await deleteOwnRecording('tayal', 'r1', url);
    expect(deleteDoc).toHaveBeenCalledTimes(1);
  });

  test('Storage 刪除失敗（例如權限、網路）時不刪文件，錯誤往外丟，讓使用者可以重試', async () => {
    deleteObject.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'storage/unauthorized' }));
    await expect(deleteOwnRecording('tayal', 'r1', url)).rejects.toThrow('denied');
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  test('沒有 storageUrl 時只刪文件', async () => {
    await deleteOwnRecording('tayal', 'r1', '');
    expect(deleteObject).not.toHaveBeenCalled();
    expect(deleteDoc).toHaveBeenCalledTimes(1);
  });
});
