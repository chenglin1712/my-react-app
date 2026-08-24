import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useTranslateCapabilities } from './useTranslateCapabilities';
import { apiGet } from '../utils/apiClient';

vi.mock('../utils/apiClient', () => ({ apiGet: vi.fn() }));

describe('useTranslateCapabilities', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  test('成功時回傳 tribes 陣列', async () => {
    apiGet.mockResolvedValue({ tribes: [{ tribeSlug: 'bunun', hasSentenceAudio: true }] });

    const { result } = renderHook(() => useTranslateCapabilities());

    await waitFor(() => expect(result.current).toEqual([{ tribeSlug: 'bunun', hasSentenceAudio: true }]));
  });

  test('失敗時維持 null，不拋出例外（只是輔助顯示用，拿不到不影響主要功能）', async () => {
    apiGet.mockRejectedValue(new Error('network fail'));

    const { result } = renderHook(() => useTranslateCapabilities());

    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeNull();
  });
});
