import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { PENDING_QUEUES, usePendingCounts } from './usePendingCounts';
import { apiGet } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({ apiGet: vi.fn() }));

const wrapper = ({ children }) => <MemoryRouter initialEntries={['/admin']}>{children}</MemoryRouter>;

describe('usePendingCounts', () => {
  beforeEach(() => { apiGet.mockReset(); });

  test('進後台時六個佇列各抓一次，以導覽路徑為鍵回傳數量', async () => {
    apiGet.mockImplementation((url) => Promise.resolve({ count: url.includes('review-queue') ? 4 : 1 }));
    const { result } = renderHook(() => usePendingCounts(), { wrapper });
    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(PENDING_QUEUES.length));
    expect(apiGet).toHaveBeenCalledTimes(PENDING_QUEUES.length);
    expect(result.current['/admin/review']).toBe(4);
    expect(result.current['/admin/moderation/reports']).toBe(1);
  });

  test('某個佇列載入失敗只是沒有那一項，不影響其他佇列', async () => {
    apiGet.mockImplementation((url) => (url.includes('/verification/')
      ? Promise.reject(Object.assign(new Error('flag off'), { status: 403 }))
      : Promise.resolve({ count: 2 })));
    const { result } = renderHook(() => usePendingCounts(), { wrapper });
    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(PENDING_QUEUES.length));
    expect(result.current['/admin/verification']).toBeNull();
    expect(result.current['/admin/review']).toBe(2);
  });

  test('同一個佇列的舊請求比新請求晚回來時，不會蓋掉新的數字', async () => {
    const resolvers = [];
    apiGet.mockImplementation((url) => (url.includes('review-queue')
      ? new Promise((resolve) => { resolvers.push(resolve); })
      : Promise.resolve({ count: 1 })));
    const { result } = renderHook(() => ({ counts: usePendingCounts(), navigate: useNavigate() }), { wrapper });
    await waitFor(() => expect(resolvers).toHaveLength(1));

    act(() => result.current.navigate('/admin/review'));
    act(() => result.current.navigate('/admin'));
    await waitFor(() => expect(resolvers).toHaveLength(2));

    await act(async () => { resolvers[1]({ count: 9 }); });
    await waitFor(() => expect(result.current.counts['/admin/review']).toBe(9));
    await act(async () => { resolvers[0]({ count: 2 }); });
    expect(result.current.counts['/admin/review']).toBe(9);
  });

  test('重抓失敗時保留上一次成功的數字', async () => {
    let fail = false;
    apiGet.mockImplementation((url) => (url.includes('review-queue') && fail
      ? Promise.reject(new Error('x'))
      : Promise.resolve({ count: 6 })));
    const { result } = renderHook(() => ({ counts: usePendingCounts(), navigate: useNavigate() }), { wrapper });
    await waitFor(() => expect(result.current.counts['/admin/review']).toBe(6));
    act(() => result.current.navigate('/admin/review'));
    fail = true;
    act(() => result.current.navigate('/admin'));
    await waitFor(() => expect(apiGet.mock.calls.filter(([u]) => u.includes('review-queue'))).toHaveLength(2));
    expect(result.current.counts['/admin/review']).toBe(6);
  });

  test('公告列表進編輯頁不重抓，從編輯頁離開才重抓', async () => {
    apiGet.mockResolvedValue({ count: 1 });
    const { result } = renderHook(() => ({ counts: usePendingCounts(), navigate: useNavigate() }), { wrapper });
    await waitFor(() => expect(Object.keys(result.current.counts)).toHaveLength(PENDING_QUEUES.length));
    act(() => result.current.navigate('/admin/content/announcements'));
    apiGet.mockClear();
    act(() => result.current.navigate('/admin/content/announcements/abc'));
    expect(apiGet).not.toHaveBeenCalled();
    act(() => result.current.navigate('/admin'));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    expect(apiGet.mock.calls[0][0]).toContain('/announcements/');
  });

  test('離開某個佇列頁後只重抓那一個佇列的數量', async () => {
    let reviewCount = 5;
    apiGet.mockImplementation((url) => Promise.resolve({ count: url.includes('review-queue') ? reviewCount : 1 }));
    const { result } = renderHook(() => ({ counts: usePendingCounts(), navigate: useNavigate() }), { wrapper });
    await waitFor(() => expect(result.current.counts['/admin/review']).toBe(5));

    act(() => result.current.navigate('/admin/review'));
    apiGet.mockClear();
    reviewCount = 3;
    act(() => result.current.navigate('/admin'));

    await waitFor(() => expect(result.current.counts['/admin/review']).toBe(3));
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet.mock.calls[0][0]).toContain('review-queue');
  });
});
