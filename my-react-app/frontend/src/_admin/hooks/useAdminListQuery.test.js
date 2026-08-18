import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useAdminListQuery } from './useAdminListQuery';
import { apiGet } from '../../../utils/apiClient';

/** 這支 hook 被十個後台頁面共用（useReviewableContentCrud 也建立在它之上），
 * 但原本沒有任何「只有最新請求能寫回狀態」的保護：使用者連續改篩選或翻頁時，
 * 先送出的舊查詢若較晚回來，就會直接蓋掉新結果——畫面變成「清單是舊條件的
 * 內容、篩選器卻顯示新條件」，而且不會有任何錯誤訊息。
 *
 * 其中錄音審核與分享筆記審核的操作並沒有後端狀態機把關（分享筆記的
 * toggle-deleted 甚至是純反轉），顯示過期清單的後果不只是看錯而已。 */
vi.mock('../../../utils/apiClient', () => ({ apiGet: vi.fn() }));

const page = (results, extra = {}) => ({
    results, count: results.length, page: 1, page_size: 20, ...extra,
});

describe('useAdminListQuery 的最新請求優先', () => {
    beforeEach(() => { apiGet.mockReset(); });
    afterEach(() => { vi.restoreAllMocks(); });

    test('舊請求較晚回來時不會覆蓋新請求的結果', async () => {
        let resolveFirst;
        apiGet.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));

        const { result } = renderHook(() => useAdminListQuery({
            endpoint: '/adminapi/things/',
            initialFilters: { status: '' },
        }));

        // 第二次查詢（較新）先回來
        let resolveSecond;
        apiGet.mockImplementationOnce(() => new Promise((r) => { resolveSecond = r; }));
        act(() => { result.current.applyFilters({ status: 'new' }); });

        await act(async () => {
            resolveSecond(page([{ id: 'NEW' }]));
            await Promise.resolve();
        });
        await waitFor(() => expect(result.current.items).toEqual([{ id: 'NEW' }]));

        // 現在第一次查詢（較舊）才回來——不能蓋掉
        await act(async () => {
            resolveFirst(page([{ id: 'OLD' }]));
            await Promise.resolve();
        });

        expect(result.current.items).toEqual([{ id: 'NEW' }]);
    });

    test('舊請求失敗不會把錯誤蓋到新請求的成功結果上', async () => {
        let rejectFirst;
        apiGet.mockImplementationOnce(() => new Promise((_, rej) => { rejectFirst = rej; }));

        const { result } = renderHook(() => useAdminListQuery({
            endpoint: '/adminapi/things/',
            initialFilters: { status: '' },
        }));

        apiGet.mockResolvedValueOnce(page([{ id: 'NEW' }]));
        act(() => { result.current.applyFilters({ status: 'new' }); });
        await waitFor(() => expect(result.current.items).toEqual([{ id: 'NEW' }]));

        await act(async () => {
            rejectFirst(new Error('舊請求爆了'));
            await Promise.resolve();
        });

        expect(result.current.error).toBe('');
        expect(result.current.items).toEqual([{ id: 'NEW' }]);
    });

    test('舊請求結束時不會提早清掉新請求的載入中狀態', async () => {
        let resolveFirst;
        apiGet.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));

        const { result } = renderHook(() => useAdminListQuery({
            endpoint: '/adminapi/things/',
            initialFilters: { status: '' },
        }));

        // 第二次查詢一直不回來，應該維持 loading
        apiGet.mockImplementationOnce(() => new Promise(() => {}));
        act(() => { result.current.applyFilters({ status: 'new' }); });

        await act(async () => {
            resolveFirst(page([{ id: 'OLD' }]));
            await Promise.resolve();
        });

        expect(result.current.loading).toBe(true);
    });

    test('enabled 為 false 時不發請求，也不停在載入中', async () => {
        const { result } = renderHook(() => useAdminListQuery({
            endpoint: '/adminapi/things/',
            initialFilters: {},
            enabled: false,
        }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(apiGet).not.toHaveBeenCalled();
    });

    test('applyFilters 會立即套用條件並把頁碼歸 1', async () => {
        apiGet.mockResolvedValue(page([]));
        const { result } = renderHook(() => useAdminListQuery({
            endpoint: '/adminapi/things/',
            initialFilters: { status: '' },
        }));
        await waitFor(() => expect(apiGet).toHaveBeenCalled());

        act(() => { result.current.setPage(3); });
        await waitFor(() => expect(result.current.page).toBe(3));

        act(() => { result.current.applyFilters({ status: 'pending' }); });

        await waitFor(() => {
            expect(result.current.page).toBe(1);
            expect(result.current.filters).toEqual({ status: 'pending' });
        });
        const lastUrl = apiGet.mock.calls.at(-1)[0];
        expect(lastUrl).toContain('status=pending');
        expect(lastUrl).toContain('page=1');
    });

    test('search 會把編輯中的 filters 送出，未按下前不影響查詢', async () => {
        apiGet.mockResolvedValue(page([]));
        const { result } = renderHook(() => useAdminListQuery({
            endpoint: '/adminapi/things/',
            initialFilters: { status: '' },
        }));
        await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));

        act(() => { result.current.setFilters({ status: 'draft' }); });
        // 還沒按搜尋，不該重新查詢
        expect(apiGet).toHaveBeenCalledTimes(1);

        act(() => { result.current.search(); });
        await waitFor(() => expect(apiGet.mock.calls.at(-1)[0]).toContain('status=draft'));
    });

    test('buildParams 可自訂參數對應（布林、需要 trim 的值）', async () => {
        apiGet.mockResolvedValue(page([]));
        renderHook(() => useAdminListQuery({
            endpoint: '/adminapi/notes/',
            initialFilters: { keyword: '  abc  ', deleted: 'false', flag: true },
            buildParams: (params, query) => {
                if (query.keyword.trim()) params.set('keyword', query.keyword.trim());
                if (query.deleted !== '') params.set('deleted', query.deleted);
                if (query.flag) params.set('flag', 'true');
            },
        }));

        await waitFor(() => expect(apiGet).toHaveBeenCalled());
        const url = apiGet.mock.calls[0][0];
        expect(url).toContain('keyword=abc');
        expect(url).toContain('deleted=false');
        expect(url).toContain('flag=true');
    });
});
