import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFavorites } from './useFavorites';
import { useAuth } from './authContext';
import { setFavoriteWord } from './userServive';
import { readActivity } from '../_learning/studyStreak';

vi.mock('./authContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('./userServive', () => ({
  setFavoriteWord: vi.fn(),
}));
vi.mock('@utils/announce', () => ({ announce: vi.fn() }));

describe('useFavorites', () => {
  const updateUserData = vi.fn();
  const baseUser = {
    uid: 'user-1',
    firestoreData: {
      favorites: [
        { id: 1, content: ['tayal-word-a'] },
        { id: 2, content: [] },
      ],
    },
  };

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    setFavoriteWord.mockResolvedValue(undefined);
  });

  test('isFavorited reflects current favorites content', () => {
    useAuth.mockReturnValue({ userData: baseUser, updateUserData });
    const { result } = renderHook(() => useFavorites());
    expect(result.current.isFavorited('tayal-word-a')).toBe(true);
    expect(result.current.isFavorited('tayal-word-b')).toBe(false);
  });

  test('toggleFavorite adds a word and optimistically syncs AuthContext', async () => {
    useAuth.mockReturnValue({ userData: baseUser, updateUserData });
    const { result } = renderHook(() => useFavorites());

    await act(async () => {
      await result.current.toggleFavorite('tayal-word-b', 1);
    });

    expect(setFavoriteWord).toHaveBeenCalledWith('user-1', 'tayal-word-b', 1, true);
    expect(updateUserData).toHaveBeenCalledTimes(1);
    const updated = updateUserData.mock.calls[0][0];
    const category1 = updated.firestoreData.favorites.find((f) => f.id === 1);
    expect(category1.content).toEqual(['tayal-word-a', 'tayal-word-b']);
  });

  test('toggleFavorite removes an already-favorited word', async () => {
    useAuth.mockReturnValue({ userData: baseUser, updateUserData });
    const { result } = renderHook(() => useFavorites());

    await act(async () => {
      await result.current.toggleFavorite('tayal-word-a', 1);
    });

    const updated = updateUserData.mock.calls[0][0];
    const category1 = updated.firestoreData.favorites.find((f) => f.id === 1);
    expect(category1.content).toEqual([]);
  });

  test('toggleFavorite is a no-op when logged out', async () => {
    useAuth.mockReturnValue({ userData: null, updateUserData });
    const { result } = renderHook(() => useFavorites());

    await act(async () => {
      await result.current.toggleFavorite('tayal-word-a', 1);
    });

    expect(setFavoriteWord).not.toHaveBeenCalled();
    expect(updateUserData).not.toHaveBeenCalled();
  });

  test('toggleFavorite reverts the optimistic update and surfaces an error when the write fails', async () => {
    useAuth.mockReturnValue({ userData: baseUser, updateUserData });
    setFavoriteWord.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useFavorites());

    await act(async () => {
      await result.current.toggleFavorite('tayal-word-b', 1);
    });

    // 第一次呼叫是樂觀更新（多了 tayal-word-b），第二次是寫入失敗後的還原
    expect(updateUserData).toHaveBeenCalledTimes(2);
    const revertedCall = updateUserData.mock.calls[1][0];
    const category1 = revertedCall.firestoreData.favorites.find((f) => f.id === 1);
    expect(category1.content).toEqual(['tayal-word-a']);
    expect(result.current.error).toBeTruthy();
  });
});

describe('useFavorites 的復原提示與還原（P2-7）', () => {
  const updateUserData = vi.fn();
  const user = () => ({ uid: 'u', firestoreData: { favorites: [{ id: 1, content: ['a'] }, { id: 2, content: ['z'] }] } });

  beforeEach(async () => {
    vi.clearAllMocks();
    setFavoriteWord.mockResolvedValue(undefined);
    const { resetToasts } = await import('../../utils/toast');
    resetToasts();
  });

  test('options.undo：顯示「已加入收藏」加「復原」；按復原就是再切換一次（不再附提示）', async () => {
    const { subscribeToasts } = await import('../../utils/toast');
    let list = [];
    subscribeToasts((t) => { list = t; });
    // 有狀態的假 AuthContext：updateUserData 真的會改掉 userData，貼近實際行為
    let current = user();
    const update = vi.fn((u) => { current = u; });
    useAuth.mockImplementation(() => ({ userData: current, updateUserData: update }));
    const { result, rerender } = renderHook(() => useFavorites());
    await act(async () => { await result.current.toggleFavorite('b', 1, { undo: true }); });
    expect(current.firestoreData.favorites[0].content).toEqual(['a', 'b']);
    expect(list).toHaveLength(1);
    expect(list[0].message).toBe('已加入收藏：b');
    expect(list[0].actionLabel).toBe('復原');
    rerender(); // 真實的 AuthContext 更新後會重新 render，這裡的假 context 要手動模擬
    setFavoriteWord.mockClear();
    await act(async () => { await list[0].onAction(); });
    expect(setFavoriteWord).toHaveBeenCalledWith('u', 'b', 1, false);
    expect(current.firestoreData.favorites[0].content).toEqual(['a']); // 回到原來的狀態
    expect(list).toHaveLength(1); // 復原本身沒有再附提示
  });

  test('沒有 undo 選項時不顯示提示（其他頁面不受影響）', async () => {
    const { subscribeToasts } = await import('../../utils/toast');
    let list = [];
    subscribeToasts((t) => { list = t; });
    useAuth.mockReturnValue({ userData: user(), updateUserData });
    const { result } = renderHook(() => useFavorites());
    await act(async () => { await result.current.toggleFavorite('b', 1); });
    expect(list).toHaveLength(0);
  });

  test('寫入失敗：只還原這個詞（對當下最新的收藏，不蓋掉期間別的切換），提示收回，說明哪個詞', async () => {
    const { subscribeToasts } = await import('../../utils/toast');
    let list = [];
    subscribeToasts((t) => { list = t; });
    const latest = { uid: 'u', firestoreData: { favorites: [{ id: 1, content: ['a', 'b', 'c'] }, { id: 2, content: ['z'] }] } };
    useAuth.mockReturnValue({ userData: latest, updateUserData });
    setFavoriteWord.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useFavorites());
    // 目前最新的收藏已含 b、c（c 是別處剛加的）；使用者切換 b（取消），寫入失敗 → 只把 b 加回，c 保留
    await act(async () => { await result.current.toggleFavorite('b', 1, { undo: true }); });
    const reverted = updateUserData.mock.calls.at(-1)[0].firestoreData.favorites.find((f) => f.id === 1).content;
    expect(reverted.sort()).toEqual(['a', 'b', 'c']);
    expect(updateUserData.mock.calls.at(-1)[0].firestoreData.favorites.find((f) => f.id === 2).content).toEqual(['z']);
    expect(list).toHaveLength(0);
    expect(result.current.error).toBe('收藏失敗，「b」已還原，請稍後再試。');
  });

  test('離線時的失敗訊息說明是沒有網路', async () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    useAuth.mockReturnValue({ userData: user(), updateUserData });
    setFavoriteWord.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useFavorites());
    await act(async () => { await result.current.toggleFavorite('b', 1); });
    expect(result.current.error).toBe('目前沒有網路，「b」的收藏沒有存下來，已還原。');
    spy.mockRestore();
  });
});

describe('useFavorites 連點（P2-7）', () => {
  test('同一個詞連點兩次：後端寫入一個接一個送，畫面最後回到原狀', async () => {
    let current = { uid: 'u', firestoreData: { favorites: [{ id: 1, content: ['a'] }] } };
    const update = vi.fn((u) => { current = u; });
    useAuth.mockImplementation(() => ({ userData: current, updateUserData: update }));
    const order = [];
    let release;
    setFavoriteWord.mockImplementationOnce(() => new Promise((res) => { order.push('start1'); release = () => { order.push('end1'); res(); }; }));
    setFavoriteWord.mockImplementationOnce(async () => { order.push('start2'); });
    const { result } = renderHook(() => useFavorites());
    let p1; let p2;
    await act(async () => {
      p1 = result.current.toggleFavorite('b', 1);
      p2 = result.current.toggleFavorite('b', 1); // 沒有 rerender：靠 userRef 同步更新讀到第一次的結果
      await Promise.resolve();
    });
    expect(order).toEqual(['start1']); // 第二個等第一個
    await act(async () => { release(); await p1; await p2; });
    expect(order).toEqual(['start1', 'end1', 'start2']);
    expect(current.firestoreData.favorites[0].content).toEqual(['a']); // 加入再取消 = 原狀
  });

  test('P6-4：新增一個收藏算一次學習活動；取消收藏不算；寫入失敗也不算', async () => {
    const updateUserData = vi.fn();
    const baseUser = { uid: 'user-1', firestoreData: { favorites: [{ id: 1, content: ['tayal-word-a'] }] } };
    useAuth.mockReturnValue({ userData: baseUser, updateUserData });
    localStorage.clear();
    setFavoriteWord.mockReset();
    setFavoriteWord.mockResolvedValue(undefined);
    const { result } = renderHook(() => useFavorites());
    const total = () => Object.values(readActivity('user-1')).reduce((a, b) => a + b, 0);

    await act(async () => { await result.current.toggleFavorite('tayal-word-b', 1); });
    expect(total()).toBe(1);

    await act(async () => { await result.current.toggleFavorite('tayal-word-a', 1); });   // 取消收藏
    expect(total()).toBe(1);

    setFavoriteWord.mockRejectedValueOnce(new Error('network'));
    await act(async () => { await result.current.toggleFavorite('tayal-word-c', 1); });
    expect(total()).toBe(1);
  });
});

describe('useFavorites 換人與登出（F10）', () => {
  const makeUser = (uid, content) => ({ uid, firestoreData: { favorites: [{ id: 1, content }] } });
  let reject;
  let slowWrite;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { resetToasts } = await import('../../utils/toast');
    resetToasts();
    // 寫入卡住，由測試決定何時失敗
    slowWrite = new Promise((_, rej) => { reject = rej; });
    setFavoriteWord.mockReturnValue(slowWrite);
  });

  test('寫入很慢，期間換成另一位使用者：失敗後不動新使用者的收藏，也不顯示錯誤', async () => {
    const updateUserData = vi.fn();
    const userA = makeUser('A', ['a']);
    const userB = makeUser('B', ['x', 'y']);
    useAuth.mockReturnValue({ userData: userA, updateUserData });
    const { result, rerender } = renderHook(() => useFavorites());

    let pending;
    await act(async () => { pending = result.current.toggleFavorite('w', 1); await Promise.resolve(); });
    expect(updateUserData).toHaveBeenCalledTimes(1);              // A 的樂觀更新
    expect(updateUserData.mock.calls[0][0].uid).toBe('A');

    useAuth.mockReturnValue({ userData: userB, updateUserData });  // 登出、B 登入
    rerender();
    await act(async () => { reject(new Error('late failure')); await pending; });

    expect(updateUserData).toHaveBeenCalledTimes(1);              // 沒有再對 B 的資料做任何還原
    expect(result.current.error).toBe('');
    expect(result.current.favorites[0].content).toEqual(['x', 'y']);
  });

  test('寫入很慢，期間登出：失敗後不會把舊使用者的資料又塞回畫面', async () => {
    const updateUserData = vi.fn();
    useAuth.mockReturnValue({ userData: makeUser('A', ['a']), updateUserData });
    const { result, rerender } = renderHook(() => useFavorites());

    let pending;
    await act(async () => { pending = result.current.toggleFavorite('w', 1); await Promise.resolve(); });

    useAuth.mockReturnValue({ userData: null, updateUserData });   // 登出
    rerender();
    await act(async () => { reject(new Error('late failure')); await pending; });

    expect(updateUserData).toHaveBeenCalledTimes(1);              // 只有最初那次樂觀更新
    expect(result.current.error).toBe('');
  });

  test('還是同一位使用者時，失敗照舊還原並顯示錯誤', async () => {
    const updateUserData = vi.fn();
    const userA = makeUser('A', ['a']);
    useAuth.mockReturnValue({ userData: userA, updateUserData });
    const { result } = renderHook(() => useFavorites());

    let pending;
    await act(async () => { pending = result.current.toggleFavorite('w', 1); await Promise.resolve(); });
    await act(async () => { reject(new Error('down')); await pending; });

    expect(updateUserData).toHaveBeenCalledTimes(2);              // 樂觀更新 + 還原
    expect(updateUserData.mock.calls[1][0].firestoreData.favorites[0].content).toEqual(['a']);
    expect(result.current.error).toBe('收藏失敗，「w」已還原，請稍後再試。');
  });

  test('換人後，上一位留下的復原提示不會去改新使用者的收藏', async () => {
    const { subscribeToasts } = await import('../../utils/toast');
    let list = [];
    subscribeToasts((t) => { list = t; });
    setFavoriteWord.mockReset();
    setFavoriteWord.mockResolvedValue(undefined);

    let current = makeUser('A', ['a']);
    const update = vi.fn((u) => { current = u; });
    useAuth.mockImplementation(() => ({ userData: current, updateUserData: update }));
    const { result, rerender } = renderHook(() => useFavorites());
    await act(async () => { await result.current.toggleFavorite('w', 1, { undo: true }); });
    expect(list).toHaveLength(1);

    current = makeUser('B', ['w']);                                // 換成 B，B 剛好也收藏了 w
    rerender();
    setFavoriteWord.mockClear();
    update.mockClear();
    await act(async () => { await list[0].onAction(); });

    expect(setFavoriteWord).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(current.firestoreData.favorites[0].content).toEqual(['w']);
  });
});

describe('useFavorites 跨分頁的明確目標狀態（FE1-01）', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setFavoriteWord.mockReset();
    const { resetToasts } = await import('../../utils/toast');
    resetToasts();
  });

  // 模擬伺服器端的 users/{uid}：setFavoriteWord 依目標狀態設定（與 userServive 的實作同語意）
  const makeServer = (content) => {
    const server = { content: [...content] };
    setFavoriteWord.mockImplementation(async (_uid, word, _cat, shouldContain) => {
      const has = server.content.includes(word);
      if (has === shouldContain) return;
      server.content = shouldContain ? [...server.content, word] : server.content.filter((w) => w !== word);
    });
    return server;
  };

  test('B 分頁資料過期（A 分頁已加入 w）：在 B 按加入，伺服器仍是已收藏，畫面也是已收藏', async () => {
    const server = makeServer(['w']);                       // A 分頁已經加入
    let current = { uid: 'u', firestoreData: { favorites: [{ id: 1, content: [] }] } }; // B 分頁的舊資料
    useAuth.mockImplementation(() => ({ userData: current, updateUserData: (u) => { current = u; } }));
    const { result } = renderHook(() => useFavorites());

    await act(async () => { await result.current.toggleFavorite('w', 1); });

    expect(setFavoriteWord).toHaveBeenCalledWith('u', 'w', 1, true);
    expect(server.content).toEqual(['w']);                  // 原本的「切換」會在這裡把它刪掉
    expect(current.firestoreData.favorites[0].content).toEqual(['w']);
  });

  test('兩個分頁交錯：A 取消、B（還以為已收藏）也取消，結果是不收藏而不是又加回來', async () => {
    const server = makeServer(['w']);
    const tab = (content) => {
      let state = { uid: 'u', firestoreData: { favorites: [{ id: 1, content }] } };
      return { get: () => state, set: (u) => { state = u; } };
    };
    const a = tab(['w']);
    const b = tab(['w']);
    useAuth.mockImplementation(() => ({ userData: a.get(), updateUserData: a.set }));
    const hookA = renderHook(() => useFavorites());
    await act(async () => { await hookA.result.current.toggleFavorite('w', 1); });
    expect(server.content).toEqual([]);

    useAuth.mockImplementation(() => ({ userData: b.get(), updateUserData: b.set }));
    const hookB = renderHook(() => useFavorites());
    await act(async () => { await hookB.result.current.toggleFavorite('w', 1); });
    expect(setFavoriteWord).toHaveBeenLastCalledWith('u', 'w', 1, false);
    expect(server.content).toEqual([]);
    expect(b.get().firestoreData.favorites[0].content).toEqual([]);
  });

  test('寫入失敗：畫面還原成送出前的狀態，伺服器沒有被改動', async () => {
    const server = makeServer([]);
    setFavoriteWord.mockRejectedValueOnce(new Error('down'));
    let current = { uid: 'u', firestoreData: { favorites: [{ id: 1, content: [] }] } };
    useAuth.mockImplementation(() => ({ userData: current, updateUserData: (u) => { current = u; } }));
    const { result } = renderHook(() => useFavorites());
    await act(async () => { await result.current.toggleFavorite('w', 1); });
    expect(current.firestoreData.favorites[0].content).toEqual([]);
    expect(server.content).toEqual([]);
    expect(result.current.error).toBe('收藏失敗，「w」已還原，請稍後再試。');
  });

  test('復原提示：按復原送出的是明確的「取消」，伺服器與畫面都回到原狀', async () => {
    const { subscribeToasts } = await import('../../utils/toast');
    let list = [];
    subscribeToasts((t) => { list = t; });
    const server = makeServer([]);
    let current = { uid: 'u', firestoreData: { favorites: [{ id: 1, content: [] }] } };
    useAuth.mockImplementation(() => ({ userData: current, updateUserData: (u) => { current = u; } }));
    const { result, rerender } = renderHook(() => useFavorites());
    await act(async () => { await result.current.toggleFavorite('w', 1, { undo: true }); });
    expect(server.content).toEqual(['w']);
    rerender();
    await act(async () => { await list[0].onAction(); });
    expect(setFavoriteWord).toHaveBeenLastCalledWith('u', 'w', 1, false);
    expect(server.content).toEqual([]);
    expect(current.firestoreData.favorites[0].content).toEqual([]);
  });
});

describe('useFavorites 公告不重複（FE1-19）', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setFavoriteWord.mockReset();
    setFavoriteWord.mockResolvedValue(undefined);
    const { resetToasts } = await import('../../utils/toast');
    resetToasts();
  });

  test('有復原提示時只由提示框播報，不另外公告；沒有提示時照常公告', async () => {
    const { announce } = await import('@utils/announce');
    const { subscribeToasts } = await import('../../utils/toast');
    let list = [];
    subscribeToasts((t) => { list = t; });
    useAuth.mockReturnValue({ userData: { uid: 'u', firestoreData: { favorites: [{ id: 1, content: [] }] } }, updateUserData: vi.fn() });
    const { result } = renderHook(() => useFavorites());

    await act(async () => { await result.current.toggleFavorite('w', 1, { undo: true }); });
    expect(list[0].message).toBe('已加入收藏：w');
    expect(announce).not.toHaveBeenCalled();

    await act(async () => { await result.current.toggleFavorite('v', 1); });
    expect(announce).toHaveBeenCalledWith('已加入收藏：v');
  });

  test('寫入失敗的錯誤訊息仍用 assertive 公告（失敗時提示框已收回）', async () => {
    const { announce } = await import('@utils/announce');
    setFavoriteWord.mockRejectedValueOnce(new Error('down'));
    useAuth.mockReturnValue({ userData: { uid: 'u', firestoreData: { favorites: [{ id: 1, content: [] }] } }, updateUserData: vi.fn() });
    const { result } = renderHook(() => useFavorites());
    await act(async () => { await result.current.toggleFavorite('w', 1, { undo: true }); });
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('收藏失敗，「w」已還原，請稍後再試。', { assertive: true });
  });
});

describe('useFavorites 學習活動不能靠連點衝數字（FE3-20）', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    setFavoriteWord.mockReset();
    setFavoriteWord.mockResolvedValue(undefined);
  });
  const total = (uid) => Object.values(readActivity(uid)).reduce((a, b) => a + b, 0);
  const setup = () => {
    let current = { uid: 'u', firestoreData: { favorites: [{ id: 1, content: [] }] } };
    useAuth.mockImplementation(() => ({ userData: current, updateUserData: (u) => { current = u; } }));
    return renderHook(() => useFavorites());
  };

  test('加入→取消→再加入同一個詞：同一天只計一次，取消也不扣', async () => {
    const { result, rerender } = setup();
    for (const _ of [1, 2, 3]) {
      await act(async () => { await result.current.toggleFavorite('w', 1); });
      rerender();
      await act(async () => { await result.current.toggleFavorite('w', 1); });
      rerender();
    }
    await act(async () => { await result.current.toggleFavorite('w', 1); });
    expect(total('u')).toBe(1);
  });

  test('不同的詞各計一次；只取消收藏不會增加次數', async () => {
    const { result, rerender } = setup();
    await act(async () => { await result.current.toggleFavorite('a', 1); });
    rerender();
    await act(async () => { await result.current.toggleFavorite('b', 1); });
    rerender();
    expect(total('u')).toBe(2);
    await act(async () => { await result.current.toggleFavorite('a', 1); });
    expect(total('u')).toBe(2);
  });
});
