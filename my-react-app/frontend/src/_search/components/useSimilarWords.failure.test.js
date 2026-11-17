import { test, vi, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import useSimilarWords from './useSimilarWords';
import { apiPost } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({ apiPost: vi.fn() }));

// P2-8：近似詞只是輔助建議，API 失敗就當作沒有，不丟例外、不打擾使用者
test('API 失敗當作沒有，不丟例外', async () => {
  apiPost.mockImplementation(async () => { throw new Error('down'); });
  const { result } = renderHook(() => useSimilarWords('balay', '泰雅', true));
  await waitFor(() => expect(result.current.done).toBe(true));
  expect(result.current.items).toEqual([]);
});
