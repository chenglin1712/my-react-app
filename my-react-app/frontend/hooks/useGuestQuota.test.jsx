import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { apiGet } from '../utils/apiClient';
import { useGuestQuota } from './useGuestQuota';

vi.mock('../utils/apiClient', () => ({ apiGet: vi.fn() }));

const apiError = (status, data) => Object.assign(new Error('x'), { status, data });

describe('useGuestQuota：訪客憑證領取或翻譯被擋時的狀態', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  test('一開始領憑證就被這個網路的核發上限擋下：直接顯示「這個網路今天用完了」', async () => {
    apiGet.mockRejectedValue(apiError(429, { code: 'guest_issue_capped', detail: 'x' }));
    const { result } = renderHook(() => useGuestQuota(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ exhausted: true, deniedReason: 'ip', remaining: 0 });
  });

  test('訪客試用沒開放（領憑證回 503 guest_unavailable）：closed，頁面改成請先登入', async () => {
    apiGet.mockRejectedValue(apiError(503, { code: 'guest_unavailable', detail: 'x' }));
    const { result } = renderHook(() => useGuestQuota(true));
    await waitFor(() => expect(result.current.status).toBe('closed'));
  });

  test('一般的伺服器暫時錯誤仍是 unknown，使用者還可以嘗試翻譯', async () => {
    apiGet.mockRejectedValue(apiError(502, {}));
    const { result } = renderHook(() => useGuestQuota(true));
    await waitFor(() => expect(result.current.status).toBe('unknown'));
  });

  test('翻譯被全站名額擋下：沿用「今天的免費試用次數用完了」', async () => {
    apiGet.mockResolvedValue({ isGuest: true, limit: 10, remaining: 3, resetsAt: 'x' });
    const { result } = renderHook(() => useGuestQuota(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let handled;
    act(() => { handled = result.current.applyError(apiError(429, { code: 'guest_global_capped', limit: 10 })); });
    expect(handled).toBe(true);
    expect(result.current).toMatchObject({ exhausted: true, deniedReason: 'browser', remaining: 0 });
  });

  test('翻譯被這個瀏覽器、這個網路的上限擋下：維持原本的兩種提示', async () => {
    apiGet.mockResolvedValue({ isGuest: true, limit: 10, remaining: 3, resetsAt: 'x' });
    const { result } = renderHook(() => useGuestQuota(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => { result.current.applyError(apiError(429, { code: 'guest_ip_capped', limit: 10 })); });
    expect(result.current.deniedReason).toBe('ip');
    act(() => { result.current.applyError(apiError(429, { code: 'guest_quota_exhausted', limit: 10 })); });
    expect(result.current.deniedReason).toBe('browser');
  });

  test('不認得的 429 不當成額度用完，交給一般錯誤訊息處理', async () => {
    apiGet.mockResolvedValue({ isGuest: true, limit: 10, remaining: 3, resetsAt: 'x' });
    const { result } = renderHook(() => useGuestQuota(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let handled;
    act(() => { handled = result.current.applyError(apiError(429, { detail: '請求太頻繁' })); });
    expect(handled).toBe(false);
    expect(result.current.remaining).toBe(3);
  });
});
