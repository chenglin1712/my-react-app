import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import axios from 'axios';

import { useMorphologyAnalysis } from './useMorphologyAnalysis';
import { apiPost } from '../utils/apiClient';

vi.mock('../utils/apiClient', () => ({ apiPost: vi.fn() }));

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('useMorphologyAnalysis', () => {
  beforeEach(() => {
    // 用大括號、不要回傳值：回傳 mock 函式本身的話，vitest 會把它當成清理函式在每個測試後呼叫。
    apiPost.mockReset();
  });

  test('成功時回傳結果，並用正確的網址與參數呼叫（沒設環境變數時退回預設路徑）', async () => {
    apiPost.mockResolvedValue({ normalized: 'abc', candidates: [] });
    const { result } = renderHook(() => useMorphologyAnalysis());

    await act(async () => { await result.current.analyze('amis', '  mafilo  '); });

    expect(apiPost).toHaveBeenCalledTimes(1);
    const [url, body, options] = apiPost.mock.calls[0];
    expect(url).toBe('/api/v1/morphology/analyze');
    expect(body).toEqual({ tribe: 'amis', word: 'mafilo' });     // 前後空白要先去掉
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(result.current).toMatchObject({ loading: false, error: '', result: { normalized: 'abc' } });
  });

  test('請求進行中 loading 為 true，且舊結果會先清掉', async () => {
    const d = deferred();
    apiPost.mockReturnValue(d.promise);
    const { result } = renderHook(() => useMorphologyAnalysis());

    act(() => { result.current.analyze('amis', 'mafilo'); });
    expect(result.current.loading).toBe(true);
    expect(result.current.result).toBeNull();

    await act(async () => { d.resolve({ ok: 1 }); await d.promise; });
    expect(result.current.loading).toBe(false);
  });

  test('失敗時顯示後端回的訊息，不留下舊結果', async () => {
    apiPost.mockRejectedValue(new Error('請一次輸入一個詞形，不要包含空白'));
    const { result } = renderHook(() => useMorphologyAnalysis());

    await act(async () => { await result.current.analyze('amis', 'a b'); });

    expect(result.current).toMatchObject({ loading: false, result: null, error: '請一次輸入一個詞形，不要包含空白' });
  });

  test('錯誤沒有訊息時用通用的中文提示', async () => {
    apiPost.mockRejectedValue(new Error(''));
    const { result } = renderHook(() => useMorphologyAnalysis());
    await act(async () => { await result.current.analyze('amis', 'x'); });
    expect(result.current.error).toBe('詞形分析失敗，請稍後再試');
  });

  test('空白輸入不會呼叫 API', async () => {
    const { result } = renderHook(() => useMorphologyAnalysis());
    await act(async () => { await result.current.analyze('amis', '   '); await result.current.analyze('amis', ''); await result.current.analyze('amis', null); });
    expect(apiPost).not.toHaveBeenCalled();
  });

  test('快速連續分析時，比較慢的舊請求晚回來也不會蓋掉新結果', async () => {
    const first = deferred();
    const second = deferred();
    apiPost.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useMorphologyAnalysis());

    act(() => { result.current.analyze('amis', 'old'); });
    act(() => { result.current.analyze('amis', 'new'); });
    await act(async () => { second.resolve({ normalized: 'new' }); await second.promise; });
    await act(async () => { first.resolve({ normalized: 'old' }); await first.promise; });

    expect(result.current.result).toEqual({ normalized: 'new' });
  });

  test('新請求會中斷上一個請求', () => {
    apiPost.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useMorphologyAnalysis());

    act(() => { result.current.analyze('amis', 'a'); });
    const firstSignal = apiPost.mock.calls[0][2].signal;
    expect(firstSignal.aborted).toBe(false);
    act(() => { result.current.analyze('amis', 'b'); });
    expect(firstSignal.aborted).toBe(true);
  });

  test('被中斷的請求不會變成錯誤訊息', async () => {
    const d = deferred();
    apiPost.mockReturnValue(d.promise);
    const { result } = renderHook(() => useMorphologyAnalysis());
    act(() => { result.current.analyze('amis', 'a'); });
    act(() => { result.current.reset(); });

    await act(async () => { d.reject(new axios.CanceledError('canceled')); await d.promise.catch(() => {}); });

    expect(result.current).toMatchObject({ loading: false, result: null, error: '' });
  });

  test('reset 會清掉結果、錯誤與進行中的請求', async () => {
    const d = deferred();
    apiPost.mockReturnValueOnce(Promise.resolve({ ok: 1 })).mockReturnValueOnce(d.promise);
    const { result } = renderHook(() => useMorphologyAnalysis());

    await act(async () => { await result.current.analyze('amis', 'a'); });
    expect(result.current.result).toEqual({ ok: 1 });
    act(() => { result.current.reset(); });
    expect(result.current).toMatchObject({ loading: false, result: null, error: '' });

    act(() => { result.current.analyze('amis', 'b'); });
    const signal = apiPost.mock.calls[1][2].signal;
    act(() => { result.current.reset(); });
    expect(signal.aborted).toBe(true);
    await act(async () => { d.resolve({ late: true }); await d.promise; });
    expect(result.current.result).toBeNull();                      // 重置之後晚回來的結果不能再冒出來
  });

  test('元件卸載時中斷進行中的請求', () => {
    apiPost.mockReturnValue(new Promise(() => {}));
    const { result, unmount } = renderHook(() => useMorphologyAnalysis());
    act(() => { result.current.analyze('amis', 'a'); });
    const signal = apiPost.mock.calls[0][2].signal;
    unmount();
    expect(signal.aborted).toBe(true);
  });

  test('analyze／reset 的函式身分穩定（放進 useEffect 依賴不會造成無限重跑）', async () => {
    apiPost.mockResolvedValue({});
    const { result, rerender } = renderHook(() => useMorphologyAnalysis());
    const { analyze, reset } = result.current;
    await act(async () => { await result.current.analyze('amis', 'a'); });
    rerender();
    await waitFor(() => expect(result.current.analyze).toBe(analyze));
    expect(result.current.reset).toBe(reset);
  });
});
