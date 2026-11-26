import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useNotesCloudSyncFlag, useNotesCloudSyncFlagStatus } from './useNotesCloudSyncFlag';
import { apiGet } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({ apiGet: vi.fn() }));

describe('useNotesCloudSyncFlag', () => {
  beforeEach(() => { apiGet.mockReset(); });

  test('沒登入（enabled=false）不發請求，結果是關閉', () => {
    const { result } = renderHook(() => useNotesCloudSyncFlag(false));
    expect(result.current).toBe(false);
    expect(apiGet).not.toHaveBeenCalled();
  });

  test('後端回報開啟才是 true', async () => {
    apiGet.mockResolvedValue({ notesCloudSync: true });
    const { result } = renderHook(() => useNotesCloudSyncFlag(true));
    await waitFor(() => expect(result.current).toBe(true));
    expect(apiGet).toHaveBeenCalledWith('/api/v1/features', expect.objectContaining({ retries: 0 }));
  });

  test.each([
    ['回報關閉', { notesCloudSync: false }],
    ['欄位不是布林 true（例如字串）', { notesCloudSync: 'true' }],
    ['回應是空的', undefined],
  ])('%s：維持關閉', async (_name, payload) => {
    apiGet.mockResolvedValue(payload);
    const { result } = renderHook(() => useNotesCloudSyncFlag(true));
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  test('請求失敗（伺服器錯誤、斷網）：維持關閉，筆記照舊只存在瀏覽器', async () => {
    apiGet.mockImplementation(() => Promise.reject(new Error('500')));
    let view;
    await act(async () => { view = renderHook(() => useNotesCloudSyncFlag(true)); });
    expect(apiGet).toHaveBeenCalled();
    expect(view.result.current).toBe(false);
  });

  test('FE6-18：查詢失敗保留「未知」，online 事件後重查，查到開啟就切換', async () => {
    apiGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ notesCloudSync: true });
    const { result } = renderHook(() => useNotesCloudSyncFlagStatus(true));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    expect(result.current).toEqual({ on: false, unknown: true });
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(result.current).toEqual({ on: true, unknown: false }));
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  test('FE6-18：失敗後依退避時間自動重試', async () => {
    vi.useFakeTimers();
    try {
      apiGet.mockRejectedValueOnce(new Error('500')).mockResolvedValueOnce({ notesCloudSync: false });
      const { result } = renderHook(() => useNotesCloudSyncFlagStatus(true));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(result.current.unknown).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(apiGet).toHaveBeenCalledTimes(2);
      expect(result.current).toEqual({ on: false, unknown: false });
    } finally { vi.useRealTimers(); }
  });

  test('FE6-18：沒登入時不是「未知」（不需要查）', () => {
    const { result } = renderHook(() => useNotesCloudSyncFlagStatus(false));
    expect(result.current).toEqual({ on: false, unknown: false });
  });
});
