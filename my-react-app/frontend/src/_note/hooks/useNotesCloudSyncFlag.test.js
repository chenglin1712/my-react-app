import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useNotesCloudSyncFlag } from './useNotesCloudSyncFlag';
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
});
