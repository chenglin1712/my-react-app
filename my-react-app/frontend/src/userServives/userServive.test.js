import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { updateDoc, runTransaction, increment, setDoc, getDoc } from 'firebase/firestore';
import { createUserWithEmailAndPassword, sendEmailVerification, onAuthStateChanged } from 'firebase/auth';
import { setFavoriteWord, updateUserErrors, registerWithImg, signOut, authChanges, initUserFields, ProfileWriteError } from './userServive';
import { STORAGE_PREFIX } from '../../components/_quiz/botStorage';
import { auth } from '../../../firebase';

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
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(), onIdTokenChanged: vi.fn(() => () => {}),
  createUserWithEmailAndPassword: vi.fn(), sendEmailVerification: vi.fn(),
}));
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

describe('setFavoriteWord（transaction，FE1-01「設成」語意）', () => {
  beforeEach(() => { runTransaction.mockReset(); updateDoc.mockReset(); });

  test('在 transaction 內讀出並寫回收藏清單', async () => {
    const store = makeStore({ favorites: [{ id: 1, content: ['a'] }] });
    await setFavoriteWord('u1', 'b', 1, true);
    expect(store.doc.favorites[0].content).toEqual(['a', 'b']);
    expect(runTransaction).toHaveBeenCalledTimes(1);
  });

  test('目標是「不收藏」時移除', async () => {
    const store = makeStore({ favorites: [{ id: 1, content: ['a', 'b'] }] });
    await setFavoriteWord('u1', 'a', 1, false);
    expect(store.doc.favorites[0].content).toEqual(['b']);
  });

  test('FE1-01：伺服器端已經收藏（別的分頁剛加入），這個分頁再按「加入」不會反而刪掉，也不寫入', async () => {
    const store = makeStore({ favorites: [{ id: 1, content: ['a', 'w'] }] });
    await setFavoriteWord('u1', 'w', 1, true);
    expect(store.doc.favorites[0].content).toEqual(['a', 'w']);
    expect(store.version).toBe(0); // 沒有寫入
  });

  test('FE1-01：伺服器端已經取消（別的裝置剛移除），這個分頁再按「取消」不會又加回來', async () => {
    const store = makeStore({ favorites: [{ id: 1, content: ['a'] }] });
    await setFavoriteWord('u1', 'w', 1, false);
    expect(store.doc.favorites[0].content).toEqual(['a']);
    expect(store.version).toBe(0);
  });

  test('FE1-01：兩個分頁交錯——B 讀完之後 A 搶先加入同一個詞，B 重跑後仍是「已收藏」', async () => {
    const store = makeStore({ favorites: [{ id: 1, content: [] }] });
    store.beforeCommit = async () => {
      store.doc.favorites = [{ id: 1, content: ['w'] }]; // A 分頁搶先寫入
      store.version += 1;
    };
    await setFavoriteWord('u1', 'w', 1, true);           // B 分頁
    expect(store.doc.favorites[0].content).toEqual(['w']);
  });

  test('另一個分頁在中途先寫入時，會重跑而不是覆蓋對方的更新（回歸測試：丟更新）', async () => {
    const store = makeStore({ favorites: [{ id: 1, content: [] }] });
    store.beforeCommit = async () => {
      store.doc.favorites = [{ id: 1, content: ['from-other-tab'] }];
      store.version += 1;
    };

    await setFavoriteWord('u1', 'mine', 1, true);

    expect(store.doc.favorites[0].content).toEqual(['from-other-tab', 'mine']);
  });

  test('只動指定分類', async () => {
    const store = makeStore({ favorites: [{ id: 1, content: ['a'] }, { id: 2, content: ['z'] }] });
    await setFavoriteWord('u1', 'b', 2, true);
    expect(store.doc.favorites).toEqual([{ id: 1, content: ['a'] }, { id: 2, content: ['z', 'b'] }]);
  });

  test('使用者文件不存在時往上拋錯', async () => {
    runTransaction.mockImplementation(async (_db, fn) => fn({ get: async () => ({ exists: () => false }), update: vi.fn() }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(setFavoriteWord('u1', 'a', 1, true)).rejects.toThrow('使用者資料不存在');
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
    await expect(registerWithImg('小明', 'a@b.c', 'secret1', '學生', null)).resolves.toMatchObject({ uid: 'u1', firestoreData: { name: '小明', identity: '學生' } });
  });
});

describe('registerWithImg 個人資料寫入失敗（FE1-04）', () => {
  let user;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    user = { uid: 'u1', delete: vi.fn().mockResolvedValue(undefined) };
    createUserWithEmailAndPassword.mockResolvedValue({ user });
    sendEmailVerification.mockResolvedValue(undefined);
    getDoc.mockReset();
    getDoc.mockResolvedValue({ exists: () => false }); // 預設：沒有別的分頁先建好文件
    updateDoc.mockReset();
    runTransaction.mockReset();
  });
  afterEach(() => { vi.useRealTimers(); delete auth.currentUser; });

  test('第一次寫入失敗會重試，重試成功就照常完成註冊、不刪帳號', async () => {
    setDoc.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(undefined);
    const call = registerWithImg('小明', 'a@b.c', 'secret1', '學生', null);
    await vi.runAllTimersAsync();
    await expect(call).resolves.toMatchObject({ uid: 'u1' });
    expect(setDoc).toHaveBeenCalledTimes(2);
    expect(user.delete).not.toHaveBeenCalled();
  });

  test('重試仍失敗：刪掉剛建立的帳號（才能用同一個 Email 重新註冊），丟出說明狀態的錯誤', async () => {
    setDoc.mockRejectedValue(new Error('unavailable'));
    const call = registerWithImg('小明', 'a@b.c', 'secret1', '學生', null).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await call;
    expect(err).toBeInstanceOf(ProfileWriteError);
    expect(err).toMatchObject({ code: 'app/profile-write-failed', accountRemoved: true });
    expect(user.delete).toHaveBeenCalledTimes(1);
    expect(sendEmailVerification).not.toHaveBeenCalled();
  });

  test('連刪除也失敗：當場補建個人資料並通知畫面（不必等重新整理），錯誤說明已用預設值建立', async () => {
    setDoc.mockRejectedValue(new Error('unavailable'));
    user.delete.mockRejectedValue(new Error('network'));
    auth.currentUser = { uid: 'u1', email: 'a@b.c' };
    let created = null;
    runTransaction.mockImplementation(async (_db, fn) => fn({
      get: async () => ({ exists: () => false }),
      set: (_ref, data) => { created = data; },
      update: vi.fn(),
    }));
    onAuthStateChanged.mockImplementation(() => () => {});
    const { state, callback } = makeState({ uid: 'u1', role: null, firestoreData: null });
    const stop = authChanges(callback);

    const call = registerWithImg('小明', 'a@b.c', 'secret1', '學生', null).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await call;
    stop();

    expect(err).toBeInstanceOf(ProfileWriteError);
    expect(err).toMatchObject({ accountRemoved: false });
    expect(created).toMatchObject({ email: 'a@b.c', name: '使用者' });     // 註冊中旗標已放掉，補建有執行
    expect(err.backfilledData).toEqual(created);
    expect(err.message).toContain('已先用預設值建立');
    expect(state.value.firestoreData).toEqual(created);                // 畫面拿到資料（導覽列可顯示登入狀態）
  });

  test('刪除與補建都失敗：仍丟出原本的 ProfileWriteError，不被補建的錯誤蓋掉', async () => {
    const writeError = new Error('unavailable');
    setDoc.mockRejectedValue(writeError);
    user.delete.mockRejectedValue(new Error('network'));
    auth.currentUser = { uid: 'u1', email: 'a@b.c' };
    runTransaction.mockRejectedValue(new Error('still offline'));
    const call = registerWithImg('小明', 'a@b.c', 'secret1', '學生', null).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await call;
    expect(err).toBeInstanceOf(ProfileWriteError);
    expect(err).toMatchObject({ accountRemoved: false, backfilledData: null, cause: writeError });
    expect(err.message).toContain('請重新整理頁面');
  });

  test('註冊競態：別的分頁已先補建文件，setDoc 被拒後採用既有文件、補上使用者填的名稱，不重寫也不刪帳號', async () => {
    setDoc.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: 'a', email: 'a@b.c', identity: '學生', favorites: [], user_errors: {}, joinDate: 'x', avatarUrl: null }) });
    updateDoc.mockResolvedValue(undefined);
    const call = registerWithImg('小明', 'a@b.c', 'secret1', '學生', 'https://img/1.png');
    await vi.runAllTimersAsync();
    const result = await call;
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(user.delete).not.toHaveBeenCalled();
    const [, updates] = updateDoc.mock.calls[0];
    expect(updates).toEqual({ name: '小明', avatarUrl: 'https://img/1.png' }); // 只改規則允許的欄位
    expect(result.firestoreData).toMatchObject({ name: '小明', joinDate: 'x', avatarUrl: 'https://img/1.png' });
    expect(sendEmailVerification).toHaveBeenCalled();
  });

  test('註冊競態：補上名稱失敗也照樣算註冊成功（文件已存在，帳號可正常使用）', async () => {
    setDoc.mockRejectedValue(new Error('denied'));
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: 'a', identity: '學生' }) });
    updateDoc.mockRejectedValue(new Error('denied'));
    const call = registerWithImg('小明', 'a@b.c', 'secret1', '學生', undefined);
    await vi.runAllTimersAsync();
    await expect(call).resolves.toMatchObject({ uid: 'u1', firestoreData: { name: 'a' } });
    expect(user.delete).not.toHaveBeenCalled();
  });
});

describe('initUserFields 補建與補欄位（FE1-04）', () => {
  let pending;
  const runWith = (snap) => {
    pending = { set: null, update: null };
    runTransaction.mockImplementation(async (_db, fn) => fn({
      get: async () => snap,
      set: (_ref, data) => { pending.set = data; },
      update: (_ref, data) => { pending.update = data; },
    }));
  };
  beforeEach(() => {
    vi.clearAllMocks();
    runTransaction.mockReset();
    auth.currentUser = { uid: 'u1', email: 'tali@example.com', displayName: null, photoURL: null };
  });
  afterEach(() => { delete auth.currentUser; });

  test('文件不存在：用與註冊相同的欄位補建（沒有 displayName 時名稱是「使用者」，不取 Email），並回傳補建的資料', async () => {
    runWith({ exists: () => false });
    const created = await initUserFields('u1');
    expect(pending.set).toMatchObject({ name: '使用者', email: 'tali@example.com', identity: '學生', user_errors: {} });
    expect(pending.set.name).not.toContain('tali');
    expect(pending.set.favorites).toHaveLength(3);
    expect(typeof pending.set.joinDate).toBe('string');
    expect(Object.keys(pending.set).sort()).toEqual(['avatarUrl', 'email', 'favorites', 'identity', 'joinDate', 'name', 'user_errors']);
    expect(created).toEqual(pending.set);
  });

  test('有 displayName 時補建沿用它（去掉前後空白）', async () => {
    auth.currentUser = { uid: 'u1', email: 'tali@example.com', displayName: '  達利  ', photoURL: null };
    runWith({ exists: () => false });
    await initUserFields('u1');
    expect(pending.set.name).toBe('達利');
  });

  test('displayName 只有空白時也用「使用者」', async () => {
    auth.currentUser = { uid: 'u1', email: 'tali@example.com', displayName: '   ', photoURL: null };
    runWith({ exists: () => false });
    await initUserFields('u1');
    expect(pending.set.name).toBe('使用者');
  });

  test('登入的已經不是這位使用者時不補建', async () => {
    runWith({ exists: () => false });
    await expect(initUserFields('someone-else')).resolves.toBeNull();
    expect(pending.set).toBeNull();
  });

  test('註冊進行中（帳號已建、資料還沒寫完）不補建，避免讓註冊的寫入被規則擋下', async () => {
    let releaseSetDoc;
    createUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u1', delete: vi.fn() } });
    setDoc.mockImplementation(() => new Promise((resolve) => { releaseSetDoc = resolve; }));
    sendEmailVerification.mockResolvedValue(undefined);
    const registering = registerWithImg('小明', 'tali@example.com', 'secret1', '學生', null);
    await vi.waitFor(() => expect(setDoc).toHaveBeenCalled());

    runWith({ exists: () => false });
    await expect(initUserFields('u1')).resolves.toBeNull();
    expect(pending.set).toBeNull();

    releaseSetDoc();
    await registering;
    runWith({ exists: () => false });
    await expect(initUserFields('u1')).resolves.not.toBeNull(); // 註冊結束後恢復補建
  });

  test('文件存在但缺欄位：只補缺的欄位，回傳 null', async () => {
    runWith({ exists: () => true, data: () => ({ name: 'x', favorites: [] }) });
    await expect(initUserFields('u1')).resolves.toBeNull();
    expect(pending.update).toEqual({ user_errors: {} });
    expect(pending.set).toBeNull();
  });
});

describe('signOut（清掉本機的 AI 對話）', () => {
  beforeEach(() => { localStorage.clear(); });

  test('clears every saved AI conversation after a successful sign-out, leaving notes alone', async () => {
    auth.signOut = vi.fn().mockResolvedValue(undefined);
    localStorage.setItem(`${STORAGE_PREFIX}u1`, '{}');
    localStorage.setItem('userNotes_u1', '[]');
    await signOut();
    expect(localStorage.getItem(`${STORAGE_PREFIX}u1`)).toBeNull();
    expect(localStorage.getItem('userNotes_u1')).toBe('[]');
  });

  test('keeps the conversation when sign-out fails', async () => {
    auth.signOut = vi.fn().mockRejectedValue(new Error('network'));
    localStorage.setItem(`${STORAGE_PREFIX}u1`, '{}');
    await expect(signOut()).rejects.toThrow('network');
    expect(localStorage.getItem(`${STORAGE_PREFIX}u1`)).toBe('{}');
  });
});

describe('authChanges（被動登出與換帳號也清 AI 對話）', () => {
  // FE1-15 起 authChanges 會在 document 上掛 visibilitychange 監聽，測試結束要取消，才不會影響後面的測試
  const subscriptions = [];
  afterEach(() => { subscriptions.splice(0).forEach((stop) => stop()); });
  beforeEach(() => {
    localStorage.clear();
    onAuthStateChanged.mockReset();
    // FE1-03 起讀取失敗會排背景重讀；這組測試與個人資料無關，讓讀取成功、補欄位不做事
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: 'x' }) });
    runTransaction.mockReset();
    runTransaction.mockResolvedValue(null);
  });

  const fire = async (user) => {
    let listener;
    onAuthStateChanged.mockImplementation((_auth, cb) => { listener = cb; return () => {}; });
    const callback = vi.fn();
    subscriptions.push(authChanges(callback));
    await listener(user);
    return callback;
  };

  test('a signed-out event (no explicit signOut call) clears every saved conversation', async () => {
    localStorage.setItem(`${STORAGE_PREFIX}u1`, '{}');
    localStorage.setItem('userNotes_u1', '[]');
    const callback = await fire(null);
    expect(callback).toHaveBeenCalledWith(null);
    expect(localStorage.getItem(`${STORAGE_PREFIX}u1`)).toBeNull();
    expect(localStorage.getItem('userNotes_u1')).toBe('[]');
  });

  test('clears the other account before the slow profile and token requests finish', async () => {
    localStorage.setItem(`${STORAGE_PREFIX}u1`, '{}');
    let listener;
    onAuthStateChanged.mockImplementation((_auth, cb) => { listener = cb; return () => {}; });
    subscriptions.push(authChanges(vi.fn()));
    const pendingToken = new Promise(() => {});          // 永遠不 resolve：模擬卡住的 token 請求
    listener({ uid: 'u2', getIdTokenResult: () => pendingToken });
    expect(localStorage.getItem(`${STORAGE_PREFIX}u1`)).toBeNull();
  });

  test('a signed-out event while an earlier sign-in is still loading wins and leaves nothing behind', async () => {
    localStorage.setItem(`${STORAGE_PREFIX}u1`, '{}');
    let listener;
    onAuthStateChanged.mockImplementation((_auth, cb) => { listener = cb; return () => {}; });
    const callback = vi.fn();
    subscriptions.push(authChanges(callback));
    let release;
    const token = new Promise((resolve) => { release = resolve; });
    const first = listener({ uid: 'u2', getIdTokenResult: () => token });
    await listener(null);
    release({ claims: {} });
    await first;
    expect(callback).toHaveBeenCalledTimes(1);          // 只有登出那次，舊的登入結果被丟棄
    expect(callback).toHaveBeenCalledWith(null);
    expect(localStorage.getItem(`${STORAGE_PREFIX}u1`)).toBeNull();
  });

  test('signing in as another account removes the previous account\'s conversation only', async () => {
    localStorage.setItem(`${STORAGE_PREFIX}u1`, '{}');
    localStorage.setItem(`${STORAGE_PREFIX}u2`, '{}');
    await fire({ uid: 'u2', getIdTokenResult: () => Promise.resolve({ claims: {} }) });
    expect(localStorage.getItem(`${STORAGE_PREFIX}u1`)).toBeNull();
    expect(localStorage.getItem(`${STORAGE_PREFIX}u2`)).toBe('{}');
  });
});

// 把 authChanges 送出的「物件或 (prev) => next」套到一個假的 AuthContext 狀態上
function makeState(initial = null) {
  const state = { value: initial };
  const callback = vi.fn((next) => { state.value = typeof next === 'function' ? next(state.value) : next; });
  return { state, callback };
}

describe('authChanges 個人資料讀取失敗（FE1-03）', () => {
  let listener;
  const signedIn = { uid: 'u1', email: 'tali@example.com', getIdTokenResult: () => Promise.resolve({ claims: {} }) };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    onAuthStateChanged.mockReset();
    onAuthStateChanged.mockImplementation((_auth, cb) => { listener = cb; return () => {}; });
    getDoc.mockReset();
    runTransaction.mockReset();
    runTransaction.mockResolvedValue(null);
  });
  afterEach(() => { vi.useRealTimers(); });

  test('讀取失敗仍視為已登入：給降級資料（名稱是「使用者」，不取 Email），之後背景重讀成功就換成真的資料', async () => {
    getDoc.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }));
    const { state, callback } = makeState();
    const stop = authChanges(callback);
    await listener(signedIn);

    expect(state.value.uid).toBe('u1');
    expect(state.value.firestoreData).toMatchObject({ name: '使用者', email: 'tali@example.com', favorites: [], profileUnavailable: true });

    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ name: '達利', favorites: [{ id: 1, content: ['a'] }] }) });
    await vi.advanceTimersByTimeAsync(3000);
    expect(state.value.firestoreData).toEqual({ name: '達利', favorites: [{ id: 1, content: ['a'] }] });
    expect(state.value.uid).toBe('u1');
    stop();
  });

  test('降級資料：有 displayName 就用它，名稱不含 Email 的任何部分', async () => {
    getDoc.mockRejectedValue(new Error('offline'));
    const { state, callback } = makeState();
    const stop = authChanges(callback);
    await listener({ ...signedIn, displayName: '達利' });
    expect(state.value.firestoreData.name).toBe('達利');
    await listener({ ...signedIn, uid: 'u2', displayName: null });
    expect(state.value.firestoreData.name).toBe('使用者');
    stop();
  });

  test('重讀持續失敗會依序退避，次數用完後瀏覽器回到線上（online）時再試一次', async () => {
    getDoc.mockRejectedValue(new Error('offline'));
    const { state, callback } = makeState();
    const stop = authChanges(callback);
    await listener(signedIn);
    await vi.advanceTimersByTimeAsync(3000 + 10000 + 30000 + 60000);
    expect(getDoc).toHaveBeenCalledTimes(4); // 第一次 + 三次重讀，之後不再計時重讀

    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ name: '達利' }) });
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.value.firestoreData).toEqual({ name: '達利' });
    stop();
  });

  test('登出後停止重讀，也不會把舊使用者的資料塞回畫面', async () => {
    getDoc.mockRejectedValueOnce(new Error('offline'));
    const { state, callback } = makeState();
    const stop = authChanges(callback);
    await listener(signedIn);
    await listener(null);
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: '達利' }) });
    await vi.advanceTimersByTimeAsync(60000);
    expect(state.value).toBeNull();
    expect(getDoc).toHaveBeenCalledTimes(1);
    stop();
  });

  test('重讀成功時若畫面上已經有完整資料（例如註冊表單補上的），不覆蓋', async () => {
    getDoc.mockRejectedValueOnce(new Error('offline'));
    const { state, callback } = makeState();
    const stop = authChanges(callback);
    await listener(signedIn);
    state.value = { uid: 'u1', role: null, firestoreData: { name: '註冊表單的資料' } };
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ name: '伺服器' }) });
    await vi.advanceTimersByTimeAsync(3000);
    expect(state.value.firestoreData).toEqual({ name: '註冊表單的資料' });
    stop();
  });

  test('文件確定不存在（不是讀取失敗）時照舊給 null，並交給 initUserFields 補建後送出', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => false });
    const created = { name: 'tali' };
    runTransaction.mockResolvedValueOnce(created);
    const { state, callback } = makeState();
    const stop = authChanges(callback);
    await listener(signedIn);
    expect(callback.mock.calls[0][0]).toMatchObject({ uid: 'u1', firestoreData: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(state.value.firestoreData).toBe(created);
    stop();
  });
});

describe('authChanges 角色 claim 更新（FE1-15）', () => {
  // 每個測試重新載入模組：本機 .env 可能設了 VITE_AUTH_DEV_BYPASS_ROLE（模組載入時就決定），
  // 前面測試沒取消訂閱的 visibilitychange 監聽也會綁在舊模組的 auth 上，不會干擾這裡的計數。
  let tokenListener;
  let authChanges;
  let auth;
  beforeEach(async () => {
    vi.stubEnv('VITE_AUTH_DEV_BYPASS_ROLE', '');
    vi.resetModules();
    const fbAuth = await import('firebase/auth');
    fbAuth.onAuthStateChanged.mockImplementation(() => () => {});
    fbAuth.onIdTokenChanged.mockImplementation((_auth, cb) => { tokenListener = cb; return () => {}; });
    ({ authChanges } = await import('./userServive'));
    ({ auth } = await import('../../../firebase'));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  test('token 換新（含強制刷新）時只更新 role，保留目前的其他狀態', async () => {
    const { state, callback } = makeState({ uid: 'u1', role: null, firestoreData: { favorites: ['樂觀更新'] } });
    const stop = authChanges(callback);
    await tokenListener({ uid: 'u1', getIdTokenResult: () => Promise.resolve({ claims: { role: 'admin' } }) });
    expect(state.value).toEqual({ uid: 'u1', role: 'admin', firestoreData: { favorites: ['樂觀更新'] } });

    await tokenListener({ uid: 'u1', getIdTokenResult: () => Promise.resolve({ claims: {} }) }); // 被撤銷
    expect(state.value.role).toBeNull();
    stop();
  });

  test('不是畫面上的那位使用者、或還沒有登入狀態時不動；讀不到 claim 時保留原本角色', async () => {
    const { state, callback } = makeState({ uid: 'u1', role: 'admin' });
    const stop = authChanges(callback);
    await tokenListener({ uid: 'u2', getIdTokenResult: () => Promise.resolve({ claims: { role: 'staff' } }) });
    expect(state.value).toEqual({ uid: 'u1', role: 'admin' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await tokenListener({ uid: 'u1', getIdTokenResult: () => Promise.reject(new Error('network')) });
    expect(state.value.role).toBe('admin');
    state.value = null;
    await tokenListener({ uid: 'u1', getIdTokenResult: () => Promise.resolve({ claims: { role: 'admin' } }) });
    expect(state.value).toBeNull();
    stop();
  });

  test('切回分頁時強制刷新 token，但至少間隔五分鐘；取消訂閱後不再刷新', () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const getIdToken = vi.fn().mockResolvedValue('tok');
    auth.currentUser = { getIdToken };
    const stop = authChanges(vi.fn());

    document.dispatchEvent(new Event('visibilitychange'));
    expect(getIdToken).not.toHaveBeenCalled(); // 剛登入，token 是新的

    vi.advanceTimersByTime(5 * 60 * 1000);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(getIdToken).toHaveBeenCalledWith(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(getIdToken).toHaveBeenCalledTimes(1);

    stop();
    vi.advanceTimersByTime(5 * 60 * 1000);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(getIdToken).toHaveBeenCalledTimes(1);
  });
});
