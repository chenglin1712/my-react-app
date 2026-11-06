import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useSearchSuggestions, { extractSuggestions, SUGGESTION_DELAY_MS, MAX_SUGGESTIONS } from './useSearchSuggestions';
import { apiPost } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({ apiPost: vi.fn() }));

const w = (name, gloss) => ({ name, explanationItems: [{ chineseExplanation: gloss }] });

describe('extractSuggestions', () => {
  test('先完全符合、再相關符合，依名稱去重，最多 5 筆', () => {
    const data = {
      exact_match_results: [w('a', '一'), w('b', '二')],
      fuzzy_match_results: { g1: { x: [w('b', '重複'), w('c', '三'), w('d', '四'), w('e', '五'), w('f', '六'), w('g', '七')] } },
    };
    const items = extractSuggestions(data);
    expect(items.map((i) => i.name)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(items).toHaveLength(MAX_SUGGESTIONS);
    expect(items[1].gloss).toBe('二');
  });

  test('完全符合也可能是 { 關鍵字: [詞] } 的物件；缺名稱或不是字串的略過', () => {
    const items = extractSuggestions({ exact_match_results: { k: [w('a', '一'), { name: '' }, { name: 5 }, {}] } });
    expect(items).toEqual([{ name: 'a', gloss: '一' }]);
  });

  test('沒有資料時回空陣列', () => {
    expect(extractSuggestions(undefined)).toEqual([]);
    expect(extractSuggestions({})).toEqual([]);
  });
});

describe('useSearchSuggestions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiPost.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  test('停止輸入 300ms 後才查一次，之前的輸入不會各自送出請求', async () => {
    apiPost.mockResolvedValue({ exact_match_results: [w('balay', '真的')], fuzzy_match_results: {} });
    const { result, rerender } = renderHook(({ q }) => useSearchSuggestions(q, '泰雅'), { initialProps: { q: 'b' } });
    rerender({ q: 'ba' });
    rerender({ q: 'bal' });
    expect(apiPost).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(SUGGESTION_DELAY_MS); });
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost.mock.calls[0][1]).toEqual({ keyword: 'bal', tribe: '泰雅' });
    expect(result.current).toEqual([{ name: 'balay', gloss: '真的' }]);
  });

  test('輸入是空白或 enabled 為 false 時不查', async () => {
    const { result, rerender } = renderHook(({ q, on }) => useSearchSuggestions(q, '泰雅', on), { initialProps: { q: '   ', on: true } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    rerender({ q: 'ba', on: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(apiPost).not.toHaveBeenCalled();
    expect(result.current).toEqual([]);
  });

  test('舊請求晚到時不會蓋掉新輸入：輸入換了，舊結果直接丟掉', async () => {
    let resolveOld;
    apiPost.mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }));
    apiPost.mockResolvedValueOnce({ exact_match_results: [w('new', '新')], fuzzy_match_results: {} });
    const { result, rerender } = renderHook(({ q }) => useSearchSuggestions(q, '泰雅'), { initialProps: { q: 'old' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(SUGGESTION_DELAY_MS); });
    rerender({ q: 'new' });
    await act(async () => { await vi.advanceTimersByTimeAsync(SUGGESTION_DELAY_MS); });
    expect(result.current.map((i) => i.name)).toEqual(['new']);
    await act(async () => { resolveOld({ exact_match_results: [w('old', '舊')], fuzzy_match_results: {} }); });
    expect(result.current.map((i) => i.name)).toEqual(['new']);
  });

  test('請求還在途中換族語：舊族語的結果不會顯示在新族語底下', async () => {
    let resolveOld;
    apiPost.mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }));
    apiPost.mockResolvedValueOnce({ exact_match_results: [w('cyux', '看')], fuzzy_match_results: {} });
    const { result, rerender } = renderHook(({ t }) => useSearchSuggestions('ba', t), { initialProps: { t: '泰雅' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(SUGGESTION_DELAY_MS); });
    rerender({ t: '阿美' });
    await act(async () => { await vi.advanceTimersByTimeAsync(SUGGESTION_DELAY_MS); });
    await act(async () => { resolveOld({ exact_match_results: [w('balay', '真的')], fuzzy_match_results: {} }); });
    expect(result.current.map((i) => i.name)).toEqual(['cyux']);
  });

  test('請求還在途中元件卸載：不會更新狀態（沒有 act 警告或錯誤）', async () => {
    let resolveOld;
    apiPost.mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }));
    const { unmount } = renderHook(() => useSearchSuggestions('ba', '泰雅'));
    await act(async () => { await vi.advanceTimersByTimeAsync(SUGGESTION_DELAY_MS); });
    unmount();
    await act(async () => { resolveOld({ exact_match_results: [w('balay', '真的')], fuzzy_match_results: {} }); });
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  test('請求失敗時安靜地不顯示建議', async () => {
    apiPost.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useSearchSuggestions('ba', '泰雅'));
    await act(async () => { await vi.advanceTimersByTimeAsync(SUGGESTION_DELAY_MS); });
    expect(result.current).toEqual([]);
  });
});
