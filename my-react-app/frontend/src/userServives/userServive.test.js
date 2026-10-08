import { describe, test, expect, vi, beforeEach } from 'vitest';
import { updateDoc, runTransaction, increment, setDoc } from 'firebase/firestore';
import { createUserWithEmailAndPassword, sendEmailVerification } from 'firebase/auth';
import { toggleFavoriteWord, updateUserErrors, registerWithImg } from './userServive';

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    doc: vi.fn((_db, ...path) => ({ __docPath: path })),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    runTransaction: vi.fn(),
    increment: vi.fn((n) => ({ __increment: n })),
  };
});
vi.mock('firebase/database', () => ({
  getDatabase: vi.fn(), ref: vi.fn(), onDisconnect: vi.fn(), set: vi.fn(),
  onValue: vi.fn(), serverTimestamp: vi.fn(),
}));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn(), createUserWithEmailAndPassword: vi.fn(), sendEmailVerification: vi.fn() }));
vi.mock('../../../firebase', () => ({ db: {}, auth: {} }));

/** 簡化版的 Firestore transaction：回呼先讀到「提交當下」的文件，寫入只暫存，
 * 回呼結束後才套用。若文件在回呼執行期間被別處改過，就丟掉這次結果重跑——
 * 跟真正 Firestore 的樂觀並行控制行為一致。 */
function makeStore(initial) {
  const store = { doc: structuredClone(initial), version: 0 };
  runTransaction.mockImplementation(async (_db, fn) => {
    for (;;) {
      const readVersion = store.version;
      let pending = null;
      const tx = {
        get: async () => ({ exists: () => true, data: () => structuredClone(store.doc) }),
        update: (_ref, data) => { pending = data; },
      };
      await fn(tx);
      // 模擬另一個分頁在回呼讀完到提交之間搶先寫入
      if (store.beforeCommit) { const hook = store.beforeCommit; store.beforeCommit = null; await hook(); }
      if (store.version !== readVersion) continue;
      if (pending) { Object.assign(store.doc, pending); store.version += 1; }
      return;
    }
  });
  return store;
}

describe('toggleFavoriteWord（transaction）', () => {
  beforeEach(() => { runTransaction.mockReset(); updateDoc.mockReset(); });

  test('在 transaction 內讀出並寫回收藏清單', async () => {
    const store = makeStore({ favorites: [{ id: 1, content: ['a'] }] });
    await toggleFavoriteWord('u1', 'b');
    expect(store.doc.favorites[0].content).toEqual(['a', 'b']);
    expect(runTransaction).toHaveBeenCalledTimes(1);
  });

  test('已收藏的單字再按一次會移除', async () => {
    const store = makeStore({ favorites: [{ id: 1, content: ['a', 'b'] }] });
    await toggleFavoriteWord('u1', 'a');
    expect(store.doc.favorites[0].content).toEqual(['b']);
  });

  test('另一個分頁在中途先寫入時，會重跑而不是覆蓋對方的更新（回歸測試：丟更新）', async () => {
    const store = makeStore({ favorites: [{ id: 1, content: [] }] });
    store.beforeCommit = async () => {
      store.doc.favorites = [{ id: 1, content: ['from-other-tab'] }];
      store.version += 1;
    };

    await toggleFavoriteWord('u1', 'mine');

    expect(store.doc.favorites[0].content).toEqual(['from-other-tab', 'mine']);
  });

  test('使用者文件不存在時往上拋錯', async () => {
    runTransaction.mockImplementation(async (_db, fn) => fn({ get: async () => ({ exists: () => false }), update: vi.fn() }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(toggleFavoriteWord('u1', 'a')).rejects.toThrow('使用者資料不存在');
  });
});

describe('updateUserErrors（原子 increment）', () => {
  beforeEach(() => { updateDoc.mockReset(); increment.mockClear(); });

  test('用 increment 原子累加，不再讀出整個 user_errors 再寫回', async () => {
    updateDoc.mockResolvedValue(undefined);
    await updateUserErrors('u1', 'lokah', 2);
    expect(updateDoc).toHaveBeenCalledTimes(1);
    const [, fieldPath, value] = updateDoc.mock.calls[0];
    expect(fieldPath.segments ?? fieldPath._internalPath?.segments).toEqual(['user_errors', 'lokah']);
    expect(value).toEqual({ __increment: 2 });
  });

  test('單字含「.」時仍視為單一欄位名稱', async () => {
    updateDoc.mockResolvedValue(undefined);
    await updateUserErrors('u1', 'a.b');
    const fieldPath = updateDoc.mock.calls[0][1];
    expect(fieldPath.segments ?? fieldPath._internalPath?.segments).toEqual(['user_errors', 'a.b']);
  });

  test('文件不存在（not-found）時靜默略過，其他錯誤只記錄不外拋', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    spy.mockClear();
    updateDoc.mockRejectedValueOnce(Object.assign(new Error('nf'), { code: 'not-found' }));
    await expect(updateUserErrors('u1', 'w')).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();

    updateDoc.mockRejectedValueOnce(new Error('boom'));
    await expect(updateUserErrors('u1', 'w')).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
  });

  test('空字串單字不會送出請求', async () => {
    await updateUserErrors('u1', '');
    expect(updateDoc).not.toHaveBeenCalled();
  });
});

describe('registerWithImg（註冊後寄驗證信）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u1' } });
    setDoc.mockResolvedValue(undefined);
  });

  test('建立帳號、寫入使用者資料後寄出 Email 驗證信', async () => {
    sendEmailVerification.mockResolvedValue(undefined);
    await registerWithImg('小明', 'a@b.c', 'secret1', '學生', null);
    expect(setDoc).toHaveBeenCalled();
    expect(sendEmailVerification).toHaveBeenCalledWith({ uid: 'u1' });
  });

  test('驗證信寄送失敗不影響註冊成功（只記錄，不丟錯）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sendEmailVerification.mockRejectedValue({ code: 'auth/too-many-requests', message: 'x' });
    await expect(registerWithImg('小明', 'a@b.c', 'secret1', '學生', null)).resolves.toBeUndefined();
  });
});
