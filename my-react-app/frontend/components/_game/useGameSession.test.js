import { describe, test, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useGameSession } from './useGameSession';
import { apiGet } from '../../utils/apiClient';

vi.mock('../../utils/apiClient', () => ({ apiGet: vi.fn() }));

describe('useGameSession', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  test('成功載入題目後 start() 回傳 true，狀態切到 playing', async () => {
    apiGet.mockResolvedValueOnce({ questions: [{ id: 1 }, { id: 2 }] });
    const { result } = renderHook(() => useGameSession({ endpoint: '/x', tribe: 'tayal', count: 2 }));

    let started;
    await act(async () => {
      started = await result.current.start();
    });

    expect(started).toBe(true);
    expect(result.current.status).toBe('playing');
    expect(result.current.questions).toHaveLength(2);
  });

  test('後端回傳的 questions 不是陣列時顯示錯誤，不會直接把非陣列塞進 state（回歸測試：原本沒有驗證回應形狀）', async () => {
    apiGet.mockResolvedValueOnce({ questions: null });
    const { result } = renderHook(() => useGameSession({ endpoint: '/x', tribe: 'tayal', count: 2 }));

    let started;
    await act(async () => {
      started = await result.current.start();
    });

    expect(started).toBe(false);
    expect(result.current.error).toBeTruthy();
    expect(result.current.status).toBe('intro');
  });

  test('loading 期間再次呼叫 start() 不會觸發第二次請求（回歸測試：原本沒有防止連續點擊）', async () => {
    let resolveFetch;
    apiGet.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const { result } = renderHook(() => useGameSession({ endpoint: '/x', tribe: 'tayal', count: 2 }));

    let firstStart;
    act(() => {
      firstStart = result.current.start();
    });
    let secondStarted;
    await act(async () => {
      secondStarted = await result.current.start();
    });

    expect(secondStarted).toBe(false);
    expect(apiGet).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch({ questions: [{ id: 1 }] });
      await firstStart;
    });
  });

  test('restart() 之後，前一次還沒回來的請求即使晚一步解析也不會把狀態拉回 playing（回歸測試：原本 restart 不會讓過期請求失效）', async () => {
    let resolveFetch;
    apiGet.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const { result } = renderHook(() => useGameSession({ endpoint: '/x', tribe: 'tayal', count: 2 }));

    let startPromise;
    act(() => {
      startPromise = result.current.start();
    });

    act(() => {
      result.current.restart();
    });
    expect(result.current.status).toBe('intro');

    await act(async () => {
      resolveFetch({ questions: [{ id: 1 }] });
      await startPromise;
    });

    // 舊的請求回來時已經過期，不該把畫面又切回 playing
    expect(result.current.status).toBe('intro');
    expect(result.current.questions).toHaveLength(0);
  });

  test('endpoint/tribe/count 改變時整個 session 會重置，不會殘留上一個設定的題目/進度（回歸測試：原本切換族語不會重置 session）', async () => {
    apiGet.mockResolvedValueOnce({ questions: [{ id: 1 }, { id: 2 }] });
    const { result, rerender } = renderHook(
      ({ tribe }) => useGameSession({ endpoint: '/x', tribe, count: 2 }),
      { initialProps: { tribe: 'tayal' } },
    );

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('playing');

    rerender({ tribe: 'amis' });

    expect(result.current.status).toBe('intro');
    expect(result.current.questions).toHaveLength(0);
  });

  test('goToNext 在最後一題時切到 result，其餘情況推進 current', async () => {
    apiGet.mockResolvedValueOnce({ questions: [{ id: 1 }, { id: 2 }] });
    const { result } = renderHook(() => useGameSession({ endpoint: '/x', tribe: 'tayal', count: 2 }));

    await act(async () => {
      await result.current.start();
    });

    act(() => { result.current.goToNext(); });
    expect(result.current.current).toBe(1);
    expect(result.current.status).toBe('playing');

    act(() => { result.current.goToNext(); });
    expect(result.current.status).toBe('result');
  });
});
