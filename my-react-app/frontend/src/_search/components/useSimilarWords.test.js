import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import useSimilarWords, { prefixCandidates } from './useSimilarWords';
import { apiPost } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({ apiPost: vi.fn() }));
// 稽核 FE3-04：改打建議端點，回應是 { suggestions: [{ name, gloss }] }
const res = (...names) => ({ suggestions: names.map((name) => ({ name, gloss: `${name}義` })) });

describe('useSimilarWords（P2-8）', () => {
  beforeEach(() => apiPost.mockClear());

  test('只去掉最後 1～2 個字元，剩下不到 2 個字元就不試', () => {
    expect(prefixCandidates('balay')).toEqual(['bala', 'bal']);
    expect(prefixCandidates('bal')).toEqual(['ba']);
    expect(prefixCandidates('ba')).toEqual([]);
    expect(prefixCandidates('')).toEqual([]);
  });

  test('找到「名稱真的以這段開頭」的詞，排除關鍵字本身，最多 5 筆', async () => {
    apiPost.mockResolvedValue(res('balay', 'balaq', 'balan', 'bala-x', 'balat', 'balaz', 'zzbala'));
    const { result } = renderHook(() => useSimilarWords('balay', '泰雅', true));
    await waitFor(() => expect(result.current.done).toBe(true));
    expect(result.current.prefix).toBe('bala');
    expect(result.current.items.map((i) => i.name)).toEqual(['balaq', 'balan', 'bala-x', 'balat', 'balaz']);
    expect(apiPost).toHaveBeenCalledTimes(1);
    // 稽核 FE3-04：打的是建議端點、只要開頭符合的詞，不是會記搜尋事件的 /key/
    expect(apiPost.mock.calls[0][0]).toMatch(/\/dictionary\/suggest\/$/);
    expect(apiPost.mock.calls[0][1]).toEqual({ keyword: 'bala', tribe: '泰雅', limit: 6, prefix_only: true });
  });

  test('稽核 FE3-14：以字素切字，不會把 U+0332 組合底線從字母上切掉', () => {
    const word = 'kn̲ga';
    expect(prefixCandidates(word)).toEqual(['kn̲g', 'kn̲']);
    // 沒有 Intl.Segmenter 的瀏覽器退回「基底字元＋組合符號」，結果相同
    expect(prefixCandidates(word, { useSegmenter: false })).toEqual(['kn̲g', 'kn̲']);
    // 撇號（喉塞音）是一個獨立的字，照常計算
    expect(prefixCandidates("'aring")).toEqual(["'arin", "'ari"]);
  });

  test('稽核 FE3-02：比對用正規化鍵（大小寫、撇號寫法），顯示保留原字', async () => {
    apiPost.mockResolvedValue(res('’Aring', "'arik"));
    const { result } = renderHook(() => useSimilarWords("'aringx", '泰雅', true));
    await waitFor(() => expect(result.current.done).toBe(true));
    // 第一段開頭是 'aring：’Aring 正規化後符合（顯示仍是 ’Aring），'arik 不符合
    expect(result.current.items.map((i) => i.name)).toEqual(['’Aring']);
  });

  test('第一段沒有就再試短一點的開頭；都沒有就回空清單（不編造）', async () => {
    apiPost.mockResolvedValueOnce(res()).mockResolvedValueOnce(res('balu'));
    const { result } = renderHook(() => useSimilarWords('balay', '泰雅', true));
    await waitFor(() => expect(result.current.done).toBe(true));
    expect(result.current.prefix).toBe('bal');
    expect(result.current.items.map((i) => i.name)).toEqual(['balu']);

    apiPost.mockClear();
    apiPost.mockResolvedValue(res('zzz'));
    const none = renderHook(() => useSimilarWords('qwerty', '泰雅', true));
    await waitFor(() => expect(none.result.current.done).toBe(true));
    expect(none.result.current.items).toEqual([]);
  });

  test('沒有啟用就不打 API', () => {
    const { result } = renderHook(() => useSimilarWords('balay', '泰雅', false));
    expect(apiPost).not.toHaveBeenCalled();
    expect(result.current).toEqual({ items: [], prefix: '', done: false });
  });
});
