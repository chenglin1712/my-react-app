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
});
