import { describe, test, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useSharedNotesPager } from './useSharedNotesPager';
import { fetchSharedNotesCount, fetchSharedNotesPage } from '../../userServives/noteService';

/** 回歸測試：原本 fetchPage/fetchTotalCount 沒有 generation 防護，快速切換
 * filter tab 時，比較慢的舊請求可能在較新的請求已經顯示結果之後才回來，
 * 把畫面蓋回舊 tab 的資料。 */

vi.mock('../../userServives/noteService', () => ({
  fetchSharedNotesPage: vi.fn(),
  fetchSharedNotesCount: vi.fn(),
}));

describe('useSharedNotesPager 的 race 防護', () => {
  test('切換 filter 後，較慢的舊分頁請求回來時不會覆蓋較新 tab 已經顯示的結果', async () => {
    let resolveLatest;
    fetchSharedNotesPage.mockImplementation(({ filter }) => {
      if (filter === 'latest') {
        return new Promise((resolve) => { resolveLatest = resolve; });
      }
      return Promise.resolve({ notes: [{ id: 'hot-1' }], hasMore: false, lastDoc: null });
    });
    fetchSharedNotesCount.mockResolvedValue(0);

    const { result, rerender } = renderHook(
      ({ filter }) => useSharedNotesPager(filter, null),
      { initialProps: { filter: 'latest' } }
    );

    rerender({ filter: 'hot' });

    await waitFor(() => expect(result.current.pageNotes).toEqual([{ id: 'hot-1' }]));

    // 「最新」那次過期的請求現在才回來
    act(() => {
      resolveLatest({ notes: [{ id: 'latest-1' }], hasMore: false, lastDoc: null });
    });
    await act(async () => { await Promise.resolve(); });

    // 畫面仍然是 hot tab 的結果，沒有被過期回應蓋掉
    expect(result.current.pageNotes).toEqual([{ id: 'hot-1' }]);
  });

  test('切換 filter 後，較慢的舊總筆數請求回來時不會覆蓋較新 tab 的總筆數', async () => {
    fetchSharedNotesPage.mockResolvedValue({ notes: [], hasMore: false, lastDoc: null });
    let resolveLatestCount;
    fetchSharedNotesCount.mockImplementation((args) => {
      if (args.filter === 'latest') {
        return new Promise((resolve) => { resolveLatestCount = resolve; });
      }
      return Promise.resolve(3);
    });

    const { result, rerender } = renderHook(
      ({ filter }) => useSharedNotesPager(filter, null),
      { initialProps: { filter: 'latest' } }
    );

    rerender({ filter: 'hot' });

    await waitFor(() => expect(result.current.totalPages).toBe(1));

    act(() => { resolveLatestCount(99); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.totalPages).toBe(1);
  });
});
