import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFavorites } from './useFavorites';
import { useAuth } from './authContext';
import { toggleFavoriteWord } from './userServive';

vi.mock('./authContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('./userServive', () => ({
  toggleFavoriteWord: vi.fn(),
}));

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
    vi.clearAllMocks();
    toggleFavoriteWord.mockResolvedValue(undefined);
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

    expect(toggleFavoriteWord).toHaveBeenCalledWith('user-1', 'tayal-word-b', 1);
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

    expect(toggleFavoriteWord).not.toHaveBeenCalled();
    expect(updateUserData).not.toHaveBeenCalled();
  });

  test('toggleFavorite reverts the optimistic update and surfaces an error when the write fails', async () => {
    useAuth.mockReturnValue({ userData: baseUser, updateUserData });
    toggleFavoriteWord.mockRejectedValue(new Error('network down'));
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
    toggleFavoriteWord.mockResolvedValue(undefined);
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
    toggleFavoriteWord.mockClear();
    await act(async () => { await list[0].onAction(); });
    expect(toggleFavoriteWord).toHaveBeenCalledWith('u', 'b', 1);
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
    toggleFavoriteWord.mockRejectedValue(new Error('down'));
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
    toggleFavoriteWord.mockRejectedValue(new Error('offline'));
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
    toggleFavoriteWord.mockImplementationOnce(() => new Promise((res) => { order.push('start1'); release = () => { order.push('end1'); res(); }; }));
    toggleFavoriteWord.mockImplementationOnce(async () => { order.push('start2'); });
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
});
