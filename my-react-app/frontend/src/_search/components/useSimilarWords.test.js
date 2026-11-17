import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import useSimilarWords, { prefixCandidates } from './useSimilarWords';
import { apiPost } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({ apiPost: vi.fn() }));
const res = (...names) => ({ exact_match_results: names.map((name) => ({ name, explanationItems: [{ chineseExplanation: `${name}義` }] })), fuzzy_match_results: {} });

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
